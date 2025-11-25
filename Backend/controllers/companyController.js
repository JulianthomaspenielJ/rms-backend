const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { Cognito, Dynamo } = require('../config/AWS');
const companyModel = require('../models/companyModel');
const { v4: uuidv4 } = require('uuid');

// Verify token and get user info
async function verifyToken(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw Object.assign(new Error('Missing bearer token'), { status: 401 });

  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
    const payload = await verifier.verify(token);
    
    return {
      username: payload['cognito:username'] || payload['username'] || payload['email'],
      email: payload.email,
      role: payload['custom:role']?.toLowerCase()
    };
  } catch (error) {
    throw Object.assign(new Error('Invalid or expired token'), { status: 401 });
  }
}

// Create a new company
async function createCompany(req, res) {
  try {
    const user = await verifyToken(req);
    const { company_name, email_address, company_size, company_location } = req.body;

    if (!company_name || !email_address) {
      return res.status(400).json({ error: 'Company name and email are required' });
    }

    const companyId = uuidv4();
    const now = new Date().toISOString();
    
    const newCompany = companyModel.buildItem({
      id: companyId,
      company_name,
      email_address,
      company_size,
      company_location,
      created_at: now,
      created_by: user.username || 'system',
      updated_at: now,
      updated_by: user.username || 'system',
      status: 'active',
      active_status: 'Active'
    });

    await Dynamo.put({
      TableName: companyModel.tableName,
      Item: newCompany
    }).promise();

    res.status(201).json({
      message: 'Company created successfully',
      data: newCompany
    });
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error'
    });
  }
}

// Get company by ID
async function getCompanyById(req, res) {
  try {
    await verifyToken(req);
    const { id } = req.params;

    const result = await Dynamo.get({
      TableName: companyModel.tableName,
      Key: { id }
    }).promise();

    if (!result.Item) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({
      data: result.Item
    });
  } catch (error) {
    console.error('Error fetching company:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error'
    });
  }
}
// Update company
async function updateCompany(req, res) {
  try {
    const user = await verifyToken(req);
    const { id } = req.params;
    const { company_name, email_address, company_size, company_location, status } = req.body;

    // Check if company exists
    const existing = await Dynamo.get({
      TableName: companyModel.tableName,
      Key: { id }
    }).promise();

    if (!existing.Item) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const now = new Date().toISOString();
    const updatedCompany = {
      ...existing.Item,
      company_name: company_name || existing.Item.company_name,
      email_address: email_address || existing.Item.email_address,
      company_size: company_size || existing.Item.company_size,
      company_location: company_location || existing.Item.company_location,
      status: status || existing.Item.status,
      updated_at: now,
      updated_by: user.username || 'system'
    };

    await Dynamo.put({
      TableName: companyModel.tableName,
      Item: updatedCompany
    }).promise();

    res.json({
      message: 'Company updated successfully',
      data: updatedCompany
    });
  } catch (error) {
    console.error('Error updating company:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error'
    });
  }
}

// Delete company
async function deleteCompany(req, res) {
  try {
    await verifyToken(req);
    const { id } = req.params;

    // Check if company exists
    const existing = await Dynamo.get({
      TableName: companyModel.tableName,
      Key: { id }
    }).promise();

    if (!existing.Item) {
      return res.status(404).json({ error: 'Company not found' });
    }

    await Dynamo.delete({
      TableName: companyModel.tableName,
      Key: { id }
    }).promise();

    res.json({
      message: 'Company deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error'
    });
  }
}

// Search companies
async function searchCompanies(req, res) {
  try {
    await verifyToken(req);
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // This is a basic implementation. For production, consider using DynamoDB Query/Scan with FilterExpressions
    // or AWS Elasticsearch for more advanced search capabilities
    const params = {
      TableName: companyModel.tableName,
      FilterExpression: 'contains(company_name, :query) OR contains(email_address, :query)',
      ExpressionAttributeValues: {
        ':query': q
      }
    };

    const result = await Dynamo.scan(params).promise();

    res.json({
      data: result.Items || []
    });
  } catch (error) {
    console.error('Error searching companies:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error'
    });
  }
}

// Toggle company status (active/inactive)
async function toggleCompanyStatus(req, res) {
  try {
    const user = await verifyToken(req);
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ 
        error: 'Status is required and must be either "active" or "inactive"' 
      });
    }

    // Check if company exists
    const existing = await Dynamo.get({
      TableName: companyModel.tableName,
      Key: { id }
    }).promise();

    if (!existing.Item) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const now = new Date().toISOString();
    const updatedCompany = {
      ...existing.Item,
      status,
      active_status: status === 'active' ? 'Active' : 'Inactive',
      updated_at: now,
      updated_by: user.username || 'system'
    };

    await Dynamo.put({
      TableName: companyModel.tableName,
      Item: updatedCompany
    }).promise();

    res.json({
      message: `Company ${status === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: updatedCompany
    });
  } catch (error) {
    console.error('Error toggling company status:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error'
    });
  }
}

module.exports = {
  createCompany,
  getCompanyById,
  updateCompany,
  deleteCompany,
  searchCompanies,
  toggleCompanyStatus
};
