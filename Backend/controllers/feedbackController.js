const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { Cognito, Dynamo } = require('../config/AWS');
const feedbackModel = require('../models/feedbackModel');
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
    userId: username,
    email: payload.email || username
  };
}

async function verifyUserRole(req) {
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
  
  // Only allow candidate, hr, and company_admin roles
  const allowedRoles = ['candidate', 'hr', 'company_admin'];
  if (!allowedRoles.includes(role)) {
    throw Object.assign(new Error('Only candidates, HR users, and company admins can create feedback'), { status: 403 });
  }

  // Return user information for use in controller functions
  return {
    username,
    userId: username,
    email: payload.email || username,
    role: role
  };
}

// POST /api/feedback/create
async function createFeedback(req, res) {
  try {
    const user = await verifyUserRole(req);
    
    const { subject, message, ratings } = req.body;
    
    // Validate required fields
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Subject is required and must be a non-empty string' });
    }
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Message is required and must be a non-empty string' });
    }
    
    if (!ratings || typeof ratings !== 'number' || ratings < 1 || ratings > 5) {
      return res.status(400).json({ ok: false, error: 'Ratings is required and must be a number between 1 and 5' });
    }
    
    const nowIso = new Date().toISOString();
    const feedbackId = uuidv4();
    
    // Build feedback item
    const feedbackItem = feedbackModel.buildItem({
      id: feedbackId,
      subject: subject.trim(),
      message: message.trim(),
      ratings: ratings,
      created_at: nowIso,
      created_by: user.userId,
      updated_at: nowIso,
      updated_by: user.userId,
      feedback_status: 'Active', // Default as active
      status: '1'
    });
    
    // Save to DynamoDB
    const putParams = {
      TableName: feedbackModel.tableName,
      Item: feedbackItem
    };
    
    await Dynamo.put(putParams).promise();
    
    // Format response
    const formattedFeedback = {
      id: feedbackItem.id,
      subject: feedbackItem.subject,
      message: feedbackItem.message,
      ratings: feedbackItem.ratings,
      feedbackStatus: feedbackItem.feedback_status,
      status: feedbackItem.status,
      createdBy: feedbackItem.created_by,
      createdAt: feedbackItem.created_at,
      updatedBy: feedbackItem.updated_by,
      updatedAt: feedbackItem.updated_at,
      userRole: user.role
    };
    
    return res.status(201).json({
      ok: true,
      message: 'Feedback created successfully',
      data: formattedFeedback
    });
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

// GET /api/feedback/list - Only super admin can access
async function feedbackList(req, res) {
  try {
    // Verify super admin access
    const superAdminUser = await verifySuperAdmin(req);
    
    // Scan all feedback from the table
    const params = { 
      TableName: feedbackModel.tableName
    };
    
    const out = await Dynamo.scan(params).promise();
    const items = out.Items || [];
    
    // Calculate statistics
    const totalFeedbackCount = items.length;
    const happyCustomersCount = items.filter(feedback => feedback.ratings >= 4).length;
    
    // Count feedbacks by user role (we need to get user details to determine role)
    let candidateCount = 0;
    let hrCount = 0;
    let companyAdminCount = 0;
    
    console.log(`Processing ${totalFeedbackCount} feedback records for role counting...`);
    
    // Get user details for each feedback to determine their role
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const roleCounts = { candidate: 0, hr: 0, company_admin: 0 };
    
    for (const feedback of items) {
      try {
        // Validate created_by before making Cognito call
        if (!feedback.created_by || 
            typeof feedback.created_by !== 'string' || 
            feedback.created_by.trim().length === 0 ||
            feedback.created_by === 'undefined' ||
            feedback.created_by === 'null') {
          console.log(`Skipping feedback ${feedback.id}: Invalid created_by value: "${feedback.created_by}"`);
          continue; // Skip this feedback
        }
        
        const user = await Cognito.adminGetUser({ 
          UserPoolId: userPoolId, 
          Username: feedback.created_by.trim() 
        }).promise();
        
        const attrs = user.UserAttributes || [];
        const roleAttr = attrs.find(a => a.Name === 'custom:role');
        const role = String(roleAttr?.Value || '').toLowerCase();
        
        if (roleCounts.hasOwnProperty(role)) {
          roleCounts[role]++;
        }
      } catch (error) {
        // If user not found or error, skip this feedback for role counting
        console.log(`Error getting user role for feedback ${feedback.id} (created_by: "${feedback.created_by}"):`, error.message);
      }
    }
    
    // Format the response according to your requirements
    const response = {
      totalFeedbackCount,
      happyCustomersCount,
      feedbackByRole: {
        candidate: roleCounts.candidate,
        hr: roleCounts.hr,
        company_admin: roleCounts.company_admin
      },
      // Include all feedback data for reference
      feedbacks: items.map(feedback => ({
        id: feedback.id,
        subject: feedback.subject,
        message: feedback.message,
        ratings: feedback.ratings,
        feedbackStatus: feedback.feedback_status,
        status: feedback.status,
        createdBy: feedback.created_by,
        createdAt: feedback.created_at,
        updatedBy: feedback.updated_by,
        updatedAt: feedback.updated_at
      }))
    };
    
    console.log(`Role counting completed. Results:`, {
      total: totalFeedbackCount,
      happy: happyCustomersCount,
      byRole: roleCounts
    });
    
    return res.json({
      ok: true,
      message: 'Feedback list retrieved successfully',
      data: response
    });
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

module.exports = { createFeedback, feedbackList };
