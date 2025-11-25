const moment = require('moment');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

const { Cognito, Dynamo } = require('../../config/AWS');
const userModel = require('../../models/userModel');
const jobDescriptionModel = require('../../models/jobDescriptionModel');
const resumeModel = require('../../models/resumeModel');
const shortlistModel = require('../../models/shortlistModel');

// Helper function to verify JWT token and get user info
async function verifyTokenAndGetUser(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw new Error('Missing bearer token');

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) {
    throw new Error('Cognito env not configured');
  }

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
        throw new Error('Invalid or expired token');
      }
    }
  }

  const username = payload['cognito:username'] || payload['username'] || payload['email'];
  if (!username) {
    throw new Error('Unable to resolve requester identity');
  }

  // Get user details from DynamoDB
  const userResult = await Dynamo.scan({
    TableName: userModel.tableName,
    FilterExpression: '#e = :email',
    ExpressionAttributeNames: { '#e': 'email_address' },
    ExpressionAttributeValues: { ':email': username }
  }).promise();

  const user = (userResult.Items || [])[0];
  if (!user) {
    throw new Error('User not found');
  }

  return { user, username };
}

// GET /api/hr/dashboard/stats - Get overall dashboard statistics
async function getDashboardStats(req, res) {
  try {
    const { user } = await verifyTokenAndGetUser(req);
    
    if (user.user_role !== 'hr') {
      return res.status(403).json({ ok: false, error: 'Only HR users can access dashboard stats' });
    }

    const companyId = user.company_id;
    if (!companyId) {
      return res.status(400).json({ ok: false, error: 'User not associated with any company' });
    }

    // Get all job descriptions for the company
    const jdResult = await Dynamo.scan({
      TableName: jobDescriptionModel.tableName,
      FilterExpression: '#company = :company_id',
      ExpressionAttributeNames: { '#company': 'company_id' },
      ExpressionAttributeValues: { ':company_id': companyId }
    }).promise();

    const jobDescriptions = jdResult.Items || [];
    const jdIds = jobDescriptions.map(jd => jd.id);

    // Get all resumes for these job descriptions
    let allResumes = [];
    if (jdIds.length > 0) {
      const resumeResult = await Dynamo.scan({
        TableName: resumeModel.tableName,
        FilterExpression: '#jd_id IN (' + jdIds.map((_, i) => `:id${i}`).join(',') + ')',
        ExpressionAttributeNames: { '#jd_id': 'jd_id' },
        ExpressionAttributeValues: jdIds.reduce((acc, id, i) => ({ ...acc, [`:id${i}`]: id }), {})
      }).promise();
      allResumes = resumeResult.Items || [];
    }

    // Get all shortlist entries for these job descriptions
    let allShortlists = [];
    if (jdIds.length > 0) {
      const shortlistResult = await Dynamo.scan({
        TableName: shortlistModel.tableName,
        FilterExpression: '#jd_id IN (' + jdIds.map((_, i) => `:id${i}`).join(',') + ')',
        ExpressionAttributeNames: { '#jd_id': 'jd_id' },
        ExpressionAttributeValues: jdIds.reduce((acc, id, i) => ({ ...acc, [`:id${i}`]: id }), {})
      }).promise();
      allShortlists = shortlistResult.Items || [];
    }

    // Calculate statistics
    const totalApplications = allResumes.length;
    const shortlisted = allShortlists.filter(s => s.stage === 'shortlisted').length;
    const hired = allShortlists.filter(s => s.stage === 'hired').length;
    const pending = totalApplications - shortlisted - hired;

    const stats = {
      totalApplications,
      shortlisted,
      hired,
      pending,
      totalJobs: jobDescriptions.length
    };

    return res.json({ ok: true, data: stats });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
}

// GET /api/hr/dashboard/applications-over-time - Get applications over time data
async function getApplicationsOverTime(req, res) {
  try {
    const { user } = await verifyTokenAndGetUser(req);
    
    if (user.user_role !== 'hr') {
      return res.status(403).json({ ok: false, error: 'Only HR users can access dashboard data' });
    }

    const companyId = user.company_id;
    if (!companyId) {
      return res.status(400).json({ ok: false, error: 'User not associated with any company' });
    }

    const { months = 12, startDate, endDate } = req.query;

    // Get all job descriptions for the company
    const jdResult = await Dynamo.scan({
      TableName: jobDescriptionModel.tableName,
      FilterExpression: '#company = :company_id',
      ExpressionAttributeNames: { '#company': 'company_id' },
      ExpressionAttributeValues: { ':company_id': companyId }
    }).promise();

    const jobDescriptions = jdResult.Items || [];
    const jdIds = jobDescriptions.map(jd => jd.id);

    // Get all resumes for these job descriptions
    let allResumes = [];
    if (jdIds.length > 0) {
      const resumeResult = await Dynamo.scan({
        TableName: resumeModel.tableName,
        FilterExpression: '#jd_id IN (' + jdIds.map((_, i) => `:id${i}`).join(',') + ')',
        ExpressionAttributeNames: { '#jd_id': 'jd_id' },
        ExpressionAttributeValues: jdIds.reduce((acc, id, i) => ({ ...acc, [`:id${i}`]: id }), {})
      }).promise();
      allResumes = (resumeResult.Items || []);
    }

    // Consider only resumes created by this HR
    const hrId = user.id || user.user_id || user.email_address; // fallback if id naming varies
    const resumesByThisHr = (allResumes || []).filter(r => r.hr_id === hrId);

    // Group applications by month
    const monthlyData = {};
    const currentDate = moment();
    
    // Initialize last N months
    for (let i = 0; i < parseInt(months); i++) {
      const monthDate = moment(currentDate).subtract(i, 'months');
      const monthKey = monthDate.format('MMM');
      const monthYear = monthDate.format('YYYY-MM');
      
      monthlyData[monthYear] = {
        name: monthKey,
        date: monthDate.toDate(),
        applications: 0
      };
    }

    // Count applications by month
    resumesByThisHr.forEach(resume => {
      const resumeDate = moment(resume.created_at);
      const monthYear = resumeDate.format('YYYY-MM');
      
      if (monthlyData[monthYear]) {
        monthlyData[monthYear].applications++;
      }
    });

    // Convert to array and sort by date
    const applicationsData = Object.values(monthlyData)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Apply date filtering if provided
    let filteredData = applicationsData;
    if (startDate && endDate) {
      const start = moment(startDate);
      const end = moment(endDate);
      filteredData = applicationsData.filter(item => {
        const itemDate = moment(item.date);
        return itemDate.isBetween(start, end, 'day', '[]');
      });
    }

    return res.json({ ok: true, data: filteredData });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
}

// GET /api/hr/dashboard/applications-by-department - Get applications grouped by department
async function getApplicationsByDepartment(req, res) {
  try {
    const { user } = await verifyTokenAndGetUser(req);
    
    if (user.user_role !== 'hr') {
      return res.status(403).json({ ok: false, error: 'Only HR users can access dashboard data' });
    }

    const companyId = user.company_id;
    if (!companyId) {
      return res.status(400).json({ ok: false, error: 'User not associated with any company' });
    }

    // Get all job descriptions for the company
    const jdResult = await Dynamo.scan({
      TableName: jobDescriptionModel.tableName,
      FilterExpression: '#company = :company_id',
      ExpressionAttributeNames: { '#company': 'company_id' },
      ExpressionAttributeValues: { ':company_id': companyId }
    }).promise();

    const jobDescriptions = jdResult.Items || [];
    const jdIds = jobDescriptions.map(jd => jd.id);

    // Get all resumes for these job descriptions
    let allResumes = [];
    if (jdIds.length > 0) {
      const resumeResult = await Dynamo.scan({
        TableName: resumeModel.tableName,
        FilterExpression: '#jd_id IN (' + jdIds.map((_, i) => `:id${i}`).join(',') + ')',
        ExpressionAttributeNames: { '#jd_id': 'jd_id' },
        ExpressionAttributeValues: jdIds.reduce((acc, id, i) => ({ ...acc, [`:id${i}`]: id }), {})
      }).promise();
      allResumes = resumeResult.Items || [];
    }

    // Group applications by department
    const departmentCounts = {};
    
    allResumes.forEach(resume => {
      const jd = jobDescriptions.find(j => j.id === resume.jd_id);
      if (jd && jd.jd_department) {
        const department = jd.jd_department;
        departmentCounts[department] = (departmentCounts[department] || 0) + 1;
      }
    });

    // Convert to array format
    const departmentData = Object.entries(departmentCounts).map(([name, value]) => ({
      name,
      value
    })).sort((a, b) => b.value - a.value);

    return res.json({ ok: true, data: departmentData });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
}

// GET /api/hr/dashboard/application-sources - Get application sources data
async function getApplicationSources(req, res) {
  try {
    const { user } = await verifyTokenAndGetUser(req);
    
    if (user.user_role !== 'hr') {
      return res.status(403).json({ ok: false, error: 'Only HR users can access dashboard data' });
    }

    const companyId = user.company_id;
    if (!companyId) {
      return res.status(400).json({ ok: false, error: 'User not associated with any company' });
    }

    // Get all job descriptions for the company
    const jdResult = await Dynamo.scan({
      TableName: jobDescriptionModel.tableName,
      FilterExpression: '#company = :company_id',
      ExpressionAttributeNames: { '#company': 'company_id' },
      ExpressionAttributeValues: { ':company_id': companyId }
    }).promise();

    const jobDescriptions = jdResult.Items || [];
    const jdIds = jobDescriptions.map(jd => jd.id);

    // Get all resumes for these job descriptions
    let allResumes = [];
    if (jdIds.length > 0) {
      const resumeResult = await Dynamo.scan({
        TableName: resumeModel.tableName,
        FilterExpression: '#jd_id IN (' + jdIds.map((_, i) => `:id${i}`).join(',') + ')',
        ExpressionAttributeNames: { '#jd_id': 'jd_id' },
        ExpressionAttributeValues: jdIds.reduce((acc, id, i) => ({ ...acc, [`:id${i}`]: id }), {})
      }).promise();
      allResumes = resumeResult.Items || [];
    }

    // For now, we'll simulate application sources since we don't have source tracking in the current schema
    // In a real implementation, you would add a source field to the resume model
    const totalApplications = allResumes.length;
    
    // Simulate source distribution (you can modify this based on actual data structure)
    const sourceData = [
      { name: 'LinkedIn', value: Math.floor(totalApplications * 0.30), percentage: 30 },
      { name: 'Indeed', value: Math.floor(totalApplications * 0.25), percentage: 25 },
      { name: 'Company Website', value: Math.floor(totalApplications * 0.20), percentage: 20 },
      { name: 'Referrals', value: Math.floor(totalApplications * 0.15), percentage: 15 },
      { name: 'Job Boards', value: Math.floor(totalApplications * 0.10), percentage: 10 }
    ];

    return res.json({ ok: true, data: sourceData });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
}

// GET /api/hr/dashboard/open-positions - Get open positions by department
async function getOpenPositions(req, res) {
  try {
    const { user } = await verifyTokenAndGetUser(req);
    
    if (user.user_role !== 'hr') {
      return res.status(403).json({ ok: false, error: 'Only HR users can access dashboard data' });
    }

    const companyId = user.company_id;
    if (!companyId) {
      return res.status(400).json({ ok: false, error: 'User not associated with any company' });
    }

    // Get all job descriptions for the company
    const jdResult = await Dynamo.scan({
      TableName: jobDescriptionModel.tableName,
      FilterExpression: '#company = :company_id',
      ExpressionAttributeNames: { '#company': 'company_id' },
      ExpressionAttributeValues: { ':company_id': companyId }
    }).promise();

    const jobDescriptions = jdResult.Items || [];
    const jdIds = jobDescriptions.map(jd => jd.id);

    // Get all resumes for these job descriptions
    let allResumes = [];
    if (jdIds.length > 0) {
      const resumeResult = await Dynamo.scan({
        TableName: resumeModel.tableName,
        FilterExpression: '#jd_id IN (' + jdIds.map((_, i) => `:id${i}`).join(',') + ')',
        ExpressionAttributeNames: { '#jd_id': 'jd_id' },
        ExpressionAttributeValues: jdIds.reduce((acc, id, i) => ({ ...acc, [`:id${i}`]: id }), {})
      }).promise();
      allResumes = resumeResult.Items || [];
    }

    // Group by department and calculate positions
    const departmentData = {};
    
    jobDescriptions.forEach(jd => {
      const department = jd.jd_department || 'Other';
      if (!departmentData[department]) {
        departmentData[department] = {
          department,
          title: jd.jd_title || 'Various Positions',
          positions: 0,
          applications: 0,
          roles: [],
          priority: 'Medium' // Default priority
        };
      }
      departmentData[department].positions++;
      departmentData[department].roles.push(jd.jd_title || 'Position');
    });

    // Count applications per department
    allResumes.forEach(resume => {
      const jd = jobDescriptions.find(j => j.id === resume.jd_id);
      if (jd && jd.jd_department) {
        const department = jd.jd_department;
        if (departmentData[department]) {
          departmentData[department].applications++;
        }
      }
    });

    // Convert to array and set priority based on application volume
    const openPositions = Object.values(departmentData).map(dept => {
      let priority = 'Low';
      if (dept.applications > 40) priority = 'High';
      else if (dept.applications > 20) priority = 'Medium';
      
      return {
        ...dept,
        priority,
        roles: [...new Set(dept.roles)] // Remove duplicates
      };
    }).sort((a, b) => b.applications - a.applications);

    return res.json({ ok: true, data: openPositions });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
}

module.exports = {
  getDashboardStats,
  getApplicationsOverTime,
  getApplicationsByDepartment,
  getApplicationSources,
  getOpenPositions
};
