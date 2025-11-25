const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { Cognito, Dynamo } = require('../../config/AWS.js');
const userModel = require('../../models/userModel');
const companyModel = require('../../models/companyModel');
const feedbackModel = require('../../models/feedbackModel');

// Verify super admin access
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
  
  if (!['superadmin', 'sub_admin'].includes(role)) {
    throw Object.assign(new Error('Only super admin can access this resource'), { status: 403 });
  }

  return {
    username,
    userId: username,
    email: payload.email || username
  };
}

// GET /api/dashboard/overview - Get dashboard overview statistics
async function getDashboardOverview(req, res) {
  try {
    await verifySuperAdmin(req);
    
    // Get companies count
    const companiesParams = { TableName: companyModel.tableName };
    const companiesResult = await Dynamo.scan(companiesParams).promise();
    const companiesCount = companiesResult.Items?.length || 0;
    
    // Get users count by role
    const usersParams = { TableName: userModel.tableName };
    const usersResult = await Dynamo.scan(usersParams).promise();
    const users = usersResult.Items || [];
    
    const recruitersCount = users.filter(user => user.user_role === 'hr').length;
    const candidatesCount = users.filter(user => user.user_role === 'Candidate').length;
    const totalUsersCount = users.length; // Total users across all roles
    
    // Get feedback count for last week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoISO = oneWeekAgo.toISOString();
    
    const feedbackParams = { TableName: feedbackModel.tableName };
    const feedbackResult = await Dynamo.scan(feedbackParams).promise();
    const recentFeedbacks = feedbackResult.Items?.filter(feedback => 
      new Date(feedback.created_at) >= oneWeekAgo
    ) || [];
    const feedbackCount = recentFeedbacks.length;
    
    const overview = {
      companies: companiesCount,
      totalUsers: totalUsersCount, // Added total user count
      recruiters: recruitersCount,
      candidates: candidatesCount,
      feedbackLastWeek: feedbackCount
    };
    
    return res.json({
      ok: true,
      message: 'Dashboard overview retrieved successfully',
      data: overview
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

// GET /api/dashboard/user-trends - Get user registration trends
async function getUserTrends(req, res) {
  try {
    await verifySuperAdmin(req);
    const { period = 'weekly' } = req.query; // weekly, monthly, daily
    
    let days = 7;
    let groupBy = 'day';
    
    if (period === 'monthly') {
      days = 30;
      groupBy = 'day';
    } else if (period === 'daily') {
      days = 7;
      groupBy = 'day';
    }
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get users created in the date range
    const usersParams = { TableName: userModel.tableName };
    const usersResult = await Dynamo.scan(usersParams).promise();
    const users = usersResult.Items || [];
    
    // Filter users by creation date
    const filteredUsers = users.filter(user => {
      const userDate = new Date(user.created_at);
      return userDate >= startDate && userDate <= endDate;
    });
    
    // Group users by date
    const userTrends = {};
    filteredUsers.forEach(user => {
      const date = new Date(user.created_at);
      let key;
      
      if (groupBy === 'day') {
        key = date.toISOString().split('T')[0]; // YYYY-MM-DD
      } else if (groupBy === 'week') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = `Week ${Math.ceil((date.getDate() + date.getDay()) / 7)}`;
      }
      
      if (!userTrends[key]) {
        userTrends[key] = 0;
      }
      userTrends[key]++;
    });
    
    // Format response for charts
    const chartData = Object.entries(userTrends).map(([name, users]) => ({
      name,
      users
    }));
    
    return res.json({
      ok: true,
      message: 'User trends retrieved successfully',
      data: chartData,
      period,
      totalDays: days
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

// GET /api/dashboard/members-overview - Get members overview with trends
async function getMembersOverview(req, res) {
  try {
    await verifySuperAdmin(req);
    const { period = 'monthly' } = req.query; // monthly, weekly, daily
    
    let months = 12;
    let groupBy = 'month';
    
    if (period === 'weekly') {
      months = 4;
      groupBy = 'week';
    } else if (period === 'daily') {
      months = 1;
      groupBy = 'day';
    }
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    
    // Get users created in the date range
    const usersParams = { TableName: userModel.tableName };
    const usersResult = await Dynamo.scan(usersParams).promise();
    const users = usersResult.Items || [];
    
    // Filter users by creation date
    const filteredUsers = users.filter(user => {
      const userDate = new Date(user.created_at);
      return userDate >= startDate && userDate <= endDate;
    });
    
    // Group users by role and date
    const membersData = {};
    
    filteredUsers.forEach(user => {
      const date = new Date(user.created_at);
      let key;
      
      if (groupBy === 'month') {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        key = monthNames[date.getMonth()];
      } else if (groupBy === 'week') {
        key = `Week ${Math.ceil((date.getDate() + date.getDay()) / 7)}`;
      } else if (groupBy === 'day') {
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        key = dayNames[date.getDay()];
      }
      
      if (!membersData[key]) {
        membersData[key] = { Jobseekers: 0, Recruiters: 0 };
      }
      
      if (user.user_role === 'candidate') {
        membersData[key].Jobseekers++;
      } else if (user.user_role === 'hr') {
        membersData[key].Recruiters++;
      }
    });
    
    // Format response for charts
    const chartData = Object.entries(membersData).map(([name, counts]) => ({
      name,
      Jobseekers: counts.Jobseekers,
      Recruiters: counts.Recruiters
    }));
    
    return res.json({
      ok: true,
      message: 'Members overview retrieved successfully',
      data: chartData,
      period,
      totalMonths: months
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

// Helper function to safely parse dates
function safeDateParse(dateString) {
  try {
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
  } catch (e) {
    return null;
  }
}



// GET /api/dashboard/users - Get paginated list of users (10 per page) in descending order of creation
async function getCandidateList(req, res) {
  try {
    await verifySuperAdmin(req);
    
    const { page = 1, limit = 10 } = req.query;
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    
    // Scan users with user_role = 'Candidate'
    const params = {
      TableName: userModel.tableName,
      Limit: limitNumber,
      FilterExpression: '#user_role = :role',
      ExpressionAttributeNames: {
        '#user_role': 'user_role'
      },
      ExpressionAttributeValues: {
        ':role': 'Candidate'
      },
      ScanIndexForward: false, // Sort in descending order
      ExclusiveStartKey: req.query.lastEvaluatedKey ? JSON.parse(decodeURIComponent(req.query.lastEvaluatedKey)) : undefined
    };
    
    const result = await Dynamo.scan(params).promise();
    
    // Format response
    const response = {
      ok: true,
      message: 'Candidates retrieved successfully',
      data: result.Items || [],
      count: result.Items ? result.Items.length : 0,
      page: pageNumber,
      limit: limitNumber
    };
    
    // Add pagination token if there are more items
    if (result.LastEvaluatedKey) {
      response.nextPageToken = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
      response.hasMore = true;
    } else {
      response.hasMore = false;
    }
    
    return res.json(response);
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

// GET /api/dashboard/recruiters - Get paginated list of recruiters (10 per page) in descending order of creation
async function getRecruiterList(req, res) {
  try {
    await verifySuperAdmin(req);
    
    const { page = 1, limit = 10 } = req.query;
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    
    // Scan users with user_role = 'company_admin'
    const params = {
      TableName: userModel.tableName,
      Limit: limitNumber,
      FilterExpression: '#user_role = :role',
      ExpressionAttributeNames: {
        '#user_role': 'user_role'
      },
      ExpressionAttributeValues: {
        ':role': 'company_admin'
      },
      ScanIndexForward: false, // Sort in descending order
      ExclusiveStartKey: req.query.lastEvaluatedKey ? JSON.parse(decodeURIComponent(req.query.lastEvaluatedKey)) : undefined
    };
    
    const result = await Dynamo.scan(params).promise();
    
    // Format response
    const response = {
      ok: true,
      message: 'Recruiters retrieved successfully',
      data: result.Items || [],
      count: result.Items ? result.Items.length : 0,
      page: pageNumber,
      limit: limitNumber
    };
    
    // Add pagination token if there are more items
    if (result.LastEvaluatedKey) {
      response.nextPageToken = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
      response.hasMore = true;
    } else {
      response.hasMore = false;
    }
    
    return res.json(response);
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

// GET /api/dashboard/recent-feedbacks - Get recent 10 feedbacks in descending order of creation
async function getRecentFeedbacks(req, res) {
  try {
    await verifySuperAdmin(req);
    
    const params = {
      TableName: 'tb_feedbacks',
      Limit: 10,
      ScanIndexForward: false, // Sort in descending order
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': '1' // Assuming '1' is the active status
      }
    };
    
    const result = await Dynamo.scan(params).promise();
    
    // Format response
    const response = {
      ok: true,
      message: 'Recent feedbacks retrieved successfully',
      data: result.Items || [],
      count: result.Items ? result.Items.length : 0
    };
    
    return res.json(response);
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

module.exports = {
  getDashboardOverview,
  getUserTrends,
  getMembersOverview,
  getCandidateList,
  getRecruiterList,
  getRecentFeedbacks
}; 
