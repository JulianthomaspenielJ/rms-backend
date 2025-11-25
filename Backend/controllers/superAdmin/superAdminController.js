const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { Cognito, Dynamo } = require('../../config/AWS.js');
const companyModel = require('../../models/companyModel');
const userModel = require('../../models/userModel');
const { v4: uuidv4 } = require('uuid');

async function verifySuperAdmin(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw Object.assign(new Error('Missing bearer token'), { status: 401 });

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) throw Object.assign(new Error('Cognito env not configured'), { status: 500 });

  let payload;
  try {
    const idVerifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
    payload = await idVerifier.verify(token);
  } catch (_) {
    try {
      const accessVerifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: 'access' });
      payload = await accessVerifier.verify(token);
    } catch (e2) {
      try {
        const jwt = require('jsonwebtoken');
        payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
        payload.__source = 'app';
      } catch (e3) {
        throw Object.assign(new Error('Invalid or expired token'), { status: 401 });
      }
    }
  }

  const username = payload['cognito:username'] || payload['username'] || payload['email'];
  if (!username) throw Object.assign(new Error('Unable to resolve requester identity'), { status: 401 });

  const adminUser = await Cognito.adminGetUser({ UserPoolId: userPoolId, Username: username }).promise();
  const attrs = adminUser.UserAttributes || [];
  const roleAttr = attrs.find(a => a.Name === 'custom:role');
  const role = String(roleAttr?.Value || '').toLowerCase();
  if (!['super_admin', 'superadmin'].includes(role)) {
    throw Object.assign(new Error('Only super admin can access this resource'), { status: 403 });
  }

  // Return user information for use in controller functions
  return {
    username,
    userId: username, // Use username as userId for DynamoDB operations
    email: payload.email || username
  };
}

// GET /api/superadmin/company-list
async function companyList(req, res) {
  
  try {
    const superAdminUser = await verifySuperAdmin(req);

    const params = { TableName: companyModel.tableName };
    const out = await Dynamo.scan(params).promise();
    const items = out.Items || [];
    
    // Format the response according to companyModel structure and map to frontend expectations
    const formattedCompanies = items.map(company => ({
      id: company.id,
      name: company.company_name,
      email: company.email_address,
      phone: company.phone || 'N/A', // phone not in model, default to N/A
      address: company.company_location,
      employees: company.company_size,
      registeredDate: company.created_at ? new Date(company.created_at).toISOString().split('T')[0] : 'N/A',
      active_status: company.active_status,
      industry: company.industry || 'N/A', // industry not in model, default to N/A
      // Include original model fields for reference
      company_size: company.company_size,
      company_location: company.company_location,
      company_name: company.company_name,
      created_at: company.created_at,
      created_by: company.created_by,
      updated_at: company.updated_at,
      updated_by: company.updated_by,
      // status: company.status
    }));
    
    return res.json({ 
      ok: true, 
      count: items.length, 
      data: formattedCompanies,
      message: 'Company list retrieved successfully'
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}


// PATCH /api/superadmin/company/status
async function changeCompanyStatus(req, res) {
  try {
    const superAdminUser = await verifySuperAdmin(req);
    
    const { company_id, active_status, email_address } = req.body;
    
    if (!company_id) {
      return res.status(400).json({ ok: false, error: 'Company ID is required' });
    }
    
    if (!email_address) {
      return res.status(400).json({ ok: false, error: 'email_address is required' });
    }
    
    if (!active_status) {
      return res.status(400).json({ ok: false, error: 'active_status is required' });
    }
    
    // Validate the status values
    const allowedStatuses = ['Active', 'Block', 'Delete'];
    if (!allowedStatuses.includes(active_status)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid status. Allowed values are: Active, Block, Delete' 
      });
    }

    // First check if company exists
    const getParams = {
      TableName: companyModel.tableName,
      Key: { 
        id: company_id,
        email_address: req.body.email_address // Include sort key
      }
    };

    const existingCompany = await Dynamo.get(getParams).promise();
    if (!existingCompany.Item) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    const currentStatus = existingCompany.Item.active_status;
    
    // Prevent changing status if company is already in that status
    if (currentStatus === active_status) {
      return res.status(400).json({ 
        ok: false, 
        error: `Company is already in ${active_status} status` 
      });
    }

    // Business logic for status transitions
    if (currentStatus === 'Delete' && active_status !== 'Active') {
      return res.status(400).json({ 
        ok: false, 
        error: 'Deleted companies can only be reactivated to Active status' 
      });
    }

    const nowIso = new Date().toISOString();
    
    // Prepare update expression
    let updateExpression = 'SET #as = :as, #ua = :ua, #ub = :ub';
    let expressionAttributeNames = {
      '#as': 'active_status',
      '#ua': 'updated_at',
      '#ub': 'updated_by'
    };
    let expressionAttributeValues = {
      ':as': active_status,
      ':ua': nowIso,
      ':ub': superAdminUser.userId
    };

    
    // Add status change timestamp
    updateExpression += ', #sc = :sc';
    expressionAttributeNames['#sc'] = 'status_changed_at';
    expressionAttributeValues[':sc'] = nowIso;
    
    const updateParams = {
      TableName: companyModel.tableName,
      Key: { 
        id: company_id,
        email_address: req.body.email_address // Include sort key
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await Dynamo.update(updateParams).promise();
    
    // Format the response for consistency
    const updatedCompany = result.Attributes;
    const formattedCompany = {
      id: updatedCompany.company_id , // Use company_id if available, fallback to id
      name: updatedCompany.company_name,
      email: updatedCompany.email_address,
      phone: updatedCompany.phone || 'N/A',
      address: updatedCompany.company_location,
      employees: updatedCompany.company_size,
      registeredDate: updatedCompany.created_at ? new Date(updatedCompany.created_at).toISOString().split('T')[0] : 'N/A',
      status: updatedCompany.active_status,
      industry: updatedCompany.industry || 'N/A',
      company_size: updatedCompany.company_size,
      company_location: updatedCompany.company_location,
      company_name: updatedCompany.company_name,
      created_at: updatedCompany.created_at,
      created_by: updatedCompany.created_by,
      updated_at: updatedCompany.updated_at,
      updated_by: updatedCompany.updated_by
    };
    
    // Generate appropriate message based on status change
    let message = `Company status changed from ${currentStatus} to ${active_status} successfully`;
  
    return res.json({ 
      ok: true, 
      message: message,
      data: formattedCompany,
      previous_status: currentStatus,
      new_status: active_status,
      status_change_timestamp: nowIso
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

// GET /api/superadmin/companies/status/:status
async function getCompaniesByStatus(req, res) {
  try {
    const superAdminUser = await verifySuperAdmin(req);
    
    const { status } = req.params;
    
    if (!status) {
      return res.status(400).json({ ok: false, error: 'Status parameter is required' });
    }
    
    // Validate the status values
    const allowedStatuses = ['Active', 'Block', 'Delete'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid status. Allowed values are: Active, Block, Delete' 
      });
    }

    // Scan companies with filter by status
    const params = { 
      TableName: companyModel.tableName,
      FilterExpression: '#as = :status',
      ExpressionAttributeNames: {
        '#as': 'active_status'
      },
      ExpressionAttributeValues: {
        ':status': status
      }
    };
    
    const out = await Dynamo.scan(params).promise();
    const items = out.Items || [];
    
    // Format the response according to companyModel structure and map to frontend expectations
    const formattedCompanies = items.map(company => ({
      id: company.id,
      name: company.company_name,
      email: company.email_address,
      phone: company.phone || 'N/A',
      address: company.company_location,
      employees: company.company_size,
      registeredDate: company.created_at ? new Date(company.created_at).toISOString().split('T')[0] : 'N/A',
      status: company.active_status,
      industry: company.industry || 'N/A',
      company_size: company.company_size,
      company_location: company.company_location,
      company_name: company.company_name,
      created_at: company.created_at,
      created_by: company.created_by,
      updated_at: company.updated_at,
      updated_by: company.updated_by
    }));
    
    return res.json({ 
      ok: true, 
      count: items.length, 
      data: formattedCompanies,
      message: `Companies with ${status} status retrieved successfully`,
      filtered_status: status
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

// GET /api/superadmin/subadmin-list
async function subAdminList(req, res) {
  try {
    const superAdminUser = await verifySuperAdmin(req);
    
    const { status: statusFilter } = req.query; // Optional status filter
    
    // Build scan parameters
    let params = { 
      TableName: userModel.tableName,
      FilterExpression: '#ur = :user_role'
    };
    
    let expressionAttributeNames = {
      '#ur': 'user_role'
    };
    
    let expressionAttributeValues = {
      ':user_role': 'sub_admin'
    };
    
    // Add status filter if provided
    if (statusFilter) {
      params.FilterExpression += ' AND #as = :status';
      expressionAttributeNames['#as'] = 'active_status';
      expressionAttributeValues[':status'] = statusFilter;
    }
    
    params.ExpressionAttributeNames = expressionAttributeNames;
    params.ExpressionAttributeValues = expressionAttributeValues;
    
    const out = await Dynamo.scan(params).promise();
    const items = out.Items || [];
    
    // Format the response for sub-admins
    const formattedSubAdmins = items.map(subAdmin => ({
      id: subAdmin.id,
      fullName: subAdmin.full_name,
      email: subAdmin.email_address,
      companyId: subAdmin.company_id || 'N/A',
      userRole: subAdmin.user_role,
      status: subAdmin.active_status || 'Active',
      registeredDate: subAdmin.created_at ? new Date(subAdmin.created_at).toISOString().split('T')[0] : 'N/A',
      lastUpdated: subAdmin.updated_at ? new Date(subAdmin.updated_at).toISOString().split('T')[0] : 'N/A',
      createdBy: subAdmin.created_by || 'N/A',
      updatedBy: subAdmin.updated_by || 'N/A',
      // Include original model fields for reference
      full_name: subAdmin.full_name,
      email_address: subAdmin.email_address,
      company_id: subAdmin.company_id,
      created_at: subAdmin.created_at,
      created_by: subAdmin.created_by,
      updated_at: subAdmin.updated_at,
      updated_by: subAdmin.updated_by,
      user_role: subAdmin.user_role,
      active_status: subAdmin.active_status
    }));
    
    return res.json({ 
      ok: true, 
      count: items.length, 
      data: formattedSubAdmins,
      message: statusFilter 
        ? `Sub-admins with ${statusFilter} status retrieved successfully`
        : 'Sub-admin list retrieved successfully',
      filtered_status: statusFilter || null
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

// PATCH /api/superadmin/subadmin/status
async function changeSubAdminStatus(req, res) {
  try {
    const superAdminUser = await verifySuperAdmin(req);
    
    const { subadmin_id, email_address, active_status } = req.body;
    
    if (!subadmin_id) {
      return res.status(400).json({ ok: false, error: 'Sub-admin ID is required' });
    }
    
    if (!email_address) {
      return res.status(400).json({ ok: false, error: 'email_address is required' });
    }
    
    if (!active_status) {
      return res.status(400).json({ ok: false, error: 'active_status is required' });
    }
    
    // Validate the status values
    const allowedStatuses = ['Active', 'Block', 'Delete'];
    if (!allowedStatuses.includes(active_status)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid status. Allowed values are: Active, Block, Delete' 
      });
    }

    // First check if sub-admin exists and is actually a sub-admin
    const getParams = {
      TableName: userModel.tableName,
      Key: { 
        id: subadmin_id,
        email_address: email_address
      }
    };

    const existingSubAdmin = await Dynamo.get(getParams).promise();
    if (!existingSubAdmin.Item) {
      return res.status(404).json({ ok: false, error: 'Sub-admin not found' });
    }

    // Verify the user is actually a sub-admin
    if (existingSubAdmin.Item.user_role !== 'sub_admin') {
      return res.status(400).json({ ok: false, error: 'User is not a sub-admin' });
    }

    const currentStatus = existingSubAdmin.Item.active_status;
    
    // Prevent changing status if sub-admin is already in that status
    if (currentStatus === active_status) {
      return res.status(400).json({ 
        ok: false, 
        error: `Sub-admin is already in ${active_status} status` 
      });
    }

    // Business logic for status transitions
    if (currentStatus === 'Delete' && active_status !== 'Active') {
      return res.status(400).json({ 
        ok: false, 
        error: 'Deleted sub-admins can only be reactivated to Active status' 
      });
    }

    const nowIso = new Date().toISOString();
    
    // Prepare update expression
    let updateExpression = 'SET #as = :as, #ua = :ua, #ub = :ub';
    let expressionAttributeNames = {
      '#as': 'active_status',
      '#ua': 'updated_at',
      '#ub': 'updated_by'
    };
    let expressionAttributeValues = {
      ':as': active_status,
      ':ua': nowIso,
      ':ub': superAdminUser.userId
    };

    // Add status change timestamp
    updateExpression += ', #sc = :sc';
    expressionAttributeNames['#sc'] = 'status_changed_at';
    expressionAttributeValues[':sc'] = nowIso;
    
    const updateParams = {
      TableName: userModel.tableName,
      Key: { 
        id: subadmin_id,
        email_address: email_address
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };

    const result = await Dynamo.update(updateParams).promise();
    
    // Format the response for consistency
    const updatedSubAdmin = result.Attributes;
    const formattedSubAdmin = {
      id: updatedSubAdmin.id,
      fullName: updatedSubAdmin.full_name,
      email: updatedSubAdmin.email_address,
      companyId: updatedSubAdmin.company_id || 'N/A',
      userRole: updatedSubAdmin.user_role,
      status: updatedSubAdmin.active_status,
      registeredDate: updatedSubAdmin.created_at ? new Date(updatedSubAdmin.created_at).toISOString().split('T')[0] : 'N/A',
      lastUpdated: updatedSubAdmin.updated_at ? new Date(updatedSubAdmin.updated_at).toISOString().split('T')[0] : 'N/A',
      createdBy: updatedSubAdmin.created_by || 'N/A',
      updatedBy: updatedSubAdmin.updated_by || 'N/A',
      // Include original model fields for reference
      full_name: updatedSubAdmin.full_name,
      email_address: updatedSubAdmin.email_address,
      company_id: updatedSubAdmin.company_id,
      created_at: updatedSubAdmin.created_at,
      created_by: updatedSubAdmin.created_by,
      updated_at: updatedSubAdmin.updated_at,
      updated_by: updatedSubAdmin.updated_by,
      user_role: updatedSubAdmin.user_role,
      active_status: updatedSubAdmin.active_status
    };
    
    // Generate appropriate message based on status change
    let message = `Sub-admin status changed from ${currentStatus} to ${active_status} successfully`;
  
    return res.json({ 
      ok: true, 
      message: message,
      data: formattedSubAdmin,
      previous_status: currentStatus,
      new_status: active_status,
      status_change_timestamp: nowIso
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

// GET /api/superadmin/subadmins/status/:status
async function getSubAdminByStatus(req, res) {
  try {
    const superAdminUser = await verifySuperAdmin(req);
    
    const { status } = req.params;
    
    if (!status) {
      return res.status(400).json({ ok: false, error: 'Status parameter is required' });
    }
    
    // Validate the status values
    const allowedStatuses = ['Active', 'Block', 'Delete'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid status. Allowed values are: Active, Block, Delete' 
      });
    }

    // Scan sub-admins with filter by status
    const params = { 
      TableName: userModel.tableName,
      FilterExpression: '#ur = :user_role AND #as = :status',
      ExpressionAttributeNames: {
        '#ur': 'user_role',
        '#as': 'active_status'
      },
      ExpressionAttributeValues: {
        ':user_role': 'sub_admin',
        ':status': status
      }
    };
    
    const out = await Dynamo.scan(params).promise();
    const items = out.Items || [];
    
    // Format the response for sub-admins
    const formattedSubAdmins = items.map(subAdmin => ({
      id: subAdmin.id,
      fullName: subAdmin.full_name,
      email: subAdmin.email_address,
      companyId: subAdmin.company_id || 'N/A',
      userRole: subAdmin.user_role,
      status: subAdmin.active_status,
      registeredDate: subAdmin.created_at ? new Date(subAdmin.created_at).toISOString().split('T')[0] : 'N/A',
      lastUpdated: subAdmin.updated_at ? new Date(subAdmin.updated_at).toISOString().split('T')[0] : 'N/A',
      createdBy: subAdmin.created_by || 'N/A',
      updatedBy: subAdmin.updated_by || 'N/A',
      // Include original model fields for reference
      full_name: subAdmin.full_name,
      email_address: subAdmin.email_address,
      company_id: subAdmin.company_id,
      created_at: subAdmin.created_at,
      created_by: subAdmin.created_by,
      updated_at: subAdmin.updated_at,
      updated_by: subAdmin.updated_by,
      user_role: subAdmin.user_role,
      active_status: subAdmin.active_status
    }));
    
    return res.json({ 
      ok: true, 
      count: items.length, 
      data: formattedSubAdmins,
      message: `Sub-admins with ${status} status retrieved successfully`,
      filtered_status: status
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

module.exports = { companyList, changeCompanyStatus, getCompaniesByStatus, subAdminList, changeSubAdminStatus, getSubAdminByStatus };
