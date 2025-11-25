const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { Dynamo } = require('../config/AWS');
const userModel = require('../models/userModel');
const jobDescriptionModel = require('../models/jobDescriptionModel');
const hrDetailsModel = require('../models/hrDetailsModel');
const shortlistModel = require('../models/shortlistModel');

// Verify token and get user info (consistent with other controllers)
async function verifyToken(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  
  console.log('Auth header received:', auth ? 'Present' : 'Missing');
  if (!token) {
    console.error('No token provided in Authorization header');
    throw Object.assign(new Error('Missing bearer token'), { status: 401 });
  }

  // Log token prefix for debugging (first 10 chars to avoid logging full token)
  console.log('Token prefix:', token.substring(0, 10) + '...');

  // Try local JWT verification first (since that's what other parts of your app use)
  try {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'dev-secret';
    console.log('Attempting local JWT verification...');
    
    const payload = jwt.verify(token, secret);
    console.log('Local JWT verification successful');
    
    return {
      username: payload.username || payload.email,
      email: payload.email,
      role: payload.role?.toLowerCase(),
      originalPayload: payload
    };
  } catch (jwtError) {
    console.error('Local JWT verification failed:', jwtError.message);
    
    // Only try Cognito if local JWT fails and Cognito is configured
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    
    if (userPoolId && clientId) {
      try {
        console.log('Attempting Cognito verification...');
        const verifier = CognitoJwtVerifier.create({ 
          userPoolId, 
          clientId, 
          tokenUse: 'id' 
        });
        
        const payload = await verifier.verify(token);
        console.log('Cognito verification successful');
        
        return {
          username: payload['cognito:username'] || payload['username'] || payload['email'],
          email: payload.email,
          role: payload['custom:role']?.toLowerCase(),
          originalPayload: payload
        };
      } catch (cognitoError) {
        console.error('Cognito verification failed:', cognitoError.message);
      }
    } else {
      console.log('Cognito not configured, skipping Cognito verification');
    }
    
    // If we get here, both verification methods failed
    console.error('All token verification methods failed');
    throw Object.assign(new Error('Invalid or expired token'), { 
      status: 401,
      details: {
        message: jwtError.message,
        stack: jwtError.stack
      }
    });
  }
}

async function resolveRequester(req) {
  return await verifyToken(req);
}

async function getCompanyIdFromRequester(userInfo) {
  const email = userInfo.email || userInfo.username;
  if (!email) throw Object.assign(new Error('Unable to resolve requester identity'), { status: 401 });

  const result = await Dynamo.scan({
    TableName: userModel.tableName,
    FilterExpression: '#e = :email',
    ExpressionAttributeNames: { '#e': 'email_address' },
    ExpressionAttributeValues: { ':email': email }
  }).promise();
  const user = (result.Items || [])[0];
  if (!user || !user.company_id) throw Object.assign(new Error('Requester not associated with any company'), { status: 403 });
  return user.company_id;
}

// GET /api/company/analytics/summary
// Returns: { totalJDs, totalApplicants }
async function getSummary(req, res) {
  try {
    const userInfo = await resolveRequester(req);
    const companyId = await getCompanyIdFromRequester(userInfo);

    // Find HRs for this company
    const hrUsers = await Dynamo.scan({
      TableName: userModel.tableName,
      FilterExpression: '#role = :role AND #company = :company',
      ExpressionAttributeNames: { '#role': 'user_role', '#company': 'company_id' },
      ExpressionAttributeValues: { ':role': 'hr', ':company': companyId }
    }).promise();
    const hrIds = (hrUsers.Items || []).map(u => u.id);

    let totalJDs = 0;
    let totalApplicants = 0;

    if (hrIds.length) {
      // All JDs created by these HRs
      const jdScan = await Dynamo.scan({ TableName: jobDescriptionModel.tableName }).promise();
      const jds = (jdScan.Items || []).filter(jd => hrIds.includes(jd.hr_id));
      totalJDs = jds.length;

      // Applicants from shortlist by these HRs or for those JDs
      const shortlistScan = await Dynamo.scan({ TableName: shortlistModel.tableName }).promise();
      const jdIds = new Set(jds.map(j => j.id));
      const applicants = (shortlistScan.Items || []).filter(s => hrIds.includes(s.hr_id) || jdIds.has(s.jd_id));
      totalApplicants = applicants.length;
    }

    return res.json({ ok: true, data: { totalJDs, totalApplicants } });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

// GET /api/company/analytics/graphs
// Returns: { jdVsMonths: [{month, jdCount}], jdByHR: [{hrId, count, name}], applicationsByDepartment: [{name, value}] }
async function getGraphs(req, res) {
  try {
    const userInfo = await resolveRequester(req);
    const companyId = await getCompanyIdFromRequester(userInfo);

    // Get HRs for company
    const hrUsers = await Dynamo.scan({
      TableName: userModel.tableName,
      FilterExpression: '#role = :role AND #company = :company',
      ExpressionAttributeNames: { '#role': 'user_role', '#company': 'company_id' },
      ExpressionAttributeValues: { ':role': 'hr', ':company': companyId }
    }).promise();
    const hrList = hrUsers.Items || [];
    const hrIds = hrList.map(u => u.id);

    // Load all relevant data in parallel
    const [jdScan, shortlistScan, hrDetailsScan] = await Promise.all([
      Dynamo.scan({ TableName: jobDescriptionModel.tableName }).promise(),
      Dynamo.scan({ TableName: shortlistModel.tableName }).promise(),
      Dynamo.scan({ TableName: hrDetailsModel.tableName }).promise()
    ]);

    const allJds = (jdScan.Items || []).filter(jd => hrIds.includes(jd.hr_id));
    const allShortlists = (shortlistScan.Items || []).filter(s => hrIds.includes(s.hr_id));
    const allHrDetails = (hrDetailsScan.Items || []).filter(d => hrIds.includes(d.hr_id));

    // jdVsMonths
    const jdVsMonthsMap = new Map(); // key: YYYY-MM, value: count
    allJds.forEach(jd => {
      const monthKey = (jd.created_at || '').slice(0, 7); // YYYY-MM
      if (!monthKey) return;
      jdVsMonthsMap.set(monthKey, (jdVsMonthsMap.get(monthKey) || 0) + 1);
    });
    const jdVsMonths = Array.from(jdVsMonthsMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, jdCount]) => ({ month, jdCount }));

    // jdByHR
    const nameById = Object.fromEntries(hrList.map(u => [u.id, u.full_name || u.email_address]));
    const jdByHRCount = {};
    allJds.forEach(jd => { jdByHRCount[jd.hr_id] = (jdByHRCount[jd.hr_id] || 0) + 1; });
    const jdByHR = Object.entries(jdByHRCount).map(([hrId, count]) => ({ hrId, count, name: nameById[hrId] || 'HR' }));

    // applicationsByDepartment (use HR department from tb_hr_details)
    const deptByHr = Object.fromEntries(allHrDetails.map(d => [d.hr_id, d.department || 'Unknown']));
    const deptCounts = {};
    allShortlists.forEach(s => {
      const dept = deptByHr[s.hr_id] || 'Unknown';
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    });
    const applicationsByDepartment = Object.entries(deptCounts).map(([name, value]) => ({ name, value }));

    return res.json({ ok: true, data: { jdVsMonths, jdByHR, applicationsByDepartment } });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

// GET /api/company/analytics/dashboard
// Returns: { totals: { totalJDs, totalApplicants }, graphs: { jdVsMonths, jdByHR, applicationsByDepartment } }
async function getDashboard(req, res) {
  try {
    const userInfo = await resolveRequester(req);
    const companyId = await getCompanyIdFromRequester(userInfo);

    // Get HR users for this company
    const hrUsers = await Dynamo.scan({
      TableName: userModel.tableName,
      FilterExpression: '#role = :role AND #company = :company',
      ExpressionAttributeNames: { '#role': 'user_role', '#company': 'company_id' },
      ExpressionAttributeValues: { ':role': 'hr', ':company': companyId }
    }).promise();
    const hrList = hrUsers.Items || [];
    const hrIds = hrList.map(u => u.id);

    let totalJDs = 0;
    let totalApplicants = 0;
    let jdVsMonths = [];
    let jdByHR = [];
    let applicationsByDepartment = [];

    if (hrIds.length) {
      const [jdScan, shortlistScan, hrDetailsScan] = await Promise.all([
        Dynamo.scan({ TableName: jobDescriptionModel.tableName }).promise(),
        Dynamo.scan({ TableName: shortlistModel.tableName }).promise(),
        Dynamo.scan({ TableName: hrDetailsModel.tableName }).promise()
      ]);

      const allJds = (jdScan.Items || []).filter(jd => hrIds.includes(jd.hr_id));
      const allShortlists = (shortlistScan.Items || []).filter(s => hrIds.includes(s.hr_id));
      const allHrDetails = (hrDetailsScan.Items || []).filter(d => hrIds.includes(d.hr_id));

      // Totals
      totalJDs = allJds.length;
      totalApplicants = allShortlists.length;

      // jdVsMonths
      const jdVsMonthsMap = new Map();
      allJds.forEach(jd => {
        const monthKey = (jd.created_at || '').slice(0, 7); // YYYY-MM
        if (!monthKey) return;
        jdVsMonthsMap.set(monthKey, (jdVsMonthsMap.get(monthKey) || 0) + 1);
      });
      jdVsMonths = Array.from(jdVsMonthsMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, jdCount]) => ({ month, jdCount }));

      // jdByHR
      const nameById = Object.fromEntries(hrList.map(u => [u.id, u.full_name || u.email_address]));
      const jdByHRCount = {};
      allJds.forEach(jd => { jdByHRCount[jd.hr_id] = (jdByHRCount[jd.hr_id] || 0) + 1; });
      jdByHR = Object.entries(jdByHRCount).map(([hrId, count]) => ({ hrId, count, name: nameById[hrId] || 'HR' }));

      // applicationsByDepartment
      const deptByHr = Object.fromEntries(allHrDetails.map(d => [d.hr_id, d.department || 'Unknown']));
      const deptCounts = {};
      allShortlists.forEach(s => {
        const dept = deptByHr[s.hr_id] || 'Unknown';
        deptCounts[dept] = (deptCounts[dept] || 0) + 1;
      });
      applicationsByDepartment = Object.entries(deptCounts).map(([name, value]) => ({ name, value }));
    }

    return res.json({
      ok: true,
      data: {
        totals: { totalJDs, totalApplicants },
        graphs: { jdVsMonths, jdByHR, applicationsByDepartment }
      }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

module.exports = { getSummary, getGraphs, getDashboard };


