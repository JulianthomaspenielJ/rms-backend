const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const bcrypt = require('bcryptjs');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

const { Cognito, Dynamo } = require('../../config/AWS');
const userModel = require('../../models/userModel');

function generateTempPassword() {
  // Meet typical Cognito policies: upper, lower, digit, special, len>=12
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const special = '@#$%&*!?';
  const all = upper + lower + nums + special;
  const pick = (str) => str[Math.floor(Math.random() * str.length)];
  while (true) {
    const required = [pick(upper), pick(lower), pick(nums), pick(special)];
    const rest = Array.from({ length: 12 - required.length }, () => pick(all));
    const arr = [...required, ...rest];
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    const pwd = arr.join('');
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd) && /[0-9]/.test(pwd) && /[@#$%&*!?]/.test(pwd) && pwd.length >= 12) return pwd;
  }
}

async function putItem(tableName, item) {
  await Dynamo.put({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(id)' }).promise();
}

async function getUserByEmail(email_address) {
  const params = {
    TableName: userModel.tableName,
    FilterExpression: '#e = :email',
    ExpressionAttributeNames: { '#e': 'email_address' },
    ExpressionAttributeValues: { ':email': email_address }
  };
  const out = await Dynamo.scan(params).promise();
  return (out.Items || [])[0] || null;
}

// POST /api/hr/invite
// Body: { email_address, full_name }
async function inviteHR(req, res) {
  try {
    // 0) AuthZ via Cognito: ensure requester is sub_admin
    const auth = req.headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: 'Missing bearer token' });

    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!userPoolId || !clientId) {
      return res.status(500).json({ ok: false, error: 'Cognito env not configured' });
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
          return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
        }
      }
    }

    const username = payload['cognito:username'] || payload['username'] || payload['email'];
    if (!username) {
      return res.status(401).json({ ok: false, error: 'Unable to resolve requester identity' });
    }
    // Get admin user details
    const adminUser = await Cognito.adminGetUser({ UserPoolId: userPoolId, Username: username }).promise();
    const attrs = adminUser.UserAttributes || [];
    const roleAttr = attrs.find(a => a.Name === 'custom:role');
    const role = String(roleAttr?.Value || '').toLowerCase();
    if (role !== 'company_admin') {
      return res.status(403).json({ ok: false, error: 'Only company admin can invite HR' });
    }

    // Get company_id of the company admin from tb_users
    const adminEmail = attrs.find(a => a.Name === 'email')?.Value;
    if (!adminEmail) {
      return res.status(400).json({ ok: false, error: 'Admin email not found' });
    }

    const adminUserData = await getUserByEmail(adminEmail);
    if (!adminUserData || !adminUserData.company_id) {
      return res.status(400).json({ ok: false, error: 'Company admin not found or not associated with any company' });
    }
    const company_id = adminUserData.company_id;

    // 1) Validate payload
    const { email_address, full_name } = req.body || {};
    if (!email_address || !full_name) {
      return res.status(400).json({ ok: false, error: 'email_address and full_name are required' });
    }
    const existing = await getUserByEmail(email_address);
    if (existing) return res.status(409).json({ ok: false, error: 'User already exists with this email' });

    const id = uuidv4();
    let tempPassword = generateTempPassword();
    let hashed = await bcrypt.hash(tempPassword, 10);
    const nowIso = moment.utc().toISOString();

    // 2) Create user in DynamoDB first
    const userItem = {
      id,
      full_name,
      email_address,
      company_id,
      created_at: nowIso,
      created_by: username,
      updated_at: nowIso,
      updated_by: username,
      user_role: 'hr',
      status: '1',
      active_status: 'Active',
      password: hashed
    };

    await putItem(process.env.DDB_USERS_TABLE || 'tb_users', userItem);

    // 3) Create user in Cognito and trigger email (handle InvalidPasswordException)
    try {
      await Cognito.adminCreateUser({
        UserPoolId: userPoolId,
        Username: email_address,
        TemporaryPassword: tempPassword,
        DesiredDeliveryMediums: ['EMAIL'],
        ForceAliasCreation: false,
        UserAttributes: [
          { Name: 'email', Value: email_address },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: full_name },
          { Name: 'custom:role', Value: 'hr' }
        ]
      }).promise();
    } catch (e) {
      if (e.code === 'InvalidPasswordException') {
        tempPassword = generateTempPassword();
        hashed = await bcrypt.hash(tempPassword, 10);
        await Cognito.adminCreateUser({
          UserPoolId: userPoolId,
          Username: email_address,
          TemporaryPassword: tempPassword,
          DesiredDeliveryMediums: ['EMAIL'],
          ForceAliasCreation: false,
          UserAttributes: [
            { Name: 'email', Value: email_address },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: full_name },
            { Name: 'custom:role', Value: 'hr' },
            { Name: 'custom:company_id', Value: company_id }
          ]
        }).promise();
      } else {
        throw e;
      }
    }

    // 3) Update DynamoDB user with Cognito sub if needed
    // The user is already created in DynamoDB with company_id

    return res.json({ ok: true, message: 'HR invited successfully' });
  } catch (error) {
    const code = error.code === 'ConditionalCheckFailedException' ? 409 : 500;
    return res.status(code).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

// POST /api/hr/set-password
// Body: { email_address, temp_password, new_password, confirm_new_password }
async function setHRPassword(req, res) {
  try {
    const { email_address, temp_password, new_password, confirm_new_password } = req.body || {};
    if (!email_address || !temp_password || !new_password || !confirm_new_password) {
      return res.status(400).json({ ok: false, error: 'email_address, temp_password, new_password, confirm_new_password are required' });
    }
    if (new_password !== confirm_new_password) {
      return res.status(400).json({ ok: false, error: 'New passwords do not match' });
    }

    const user = await getUserByEmail(email_address);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    if (user.user_role !== 'hr') return res.status(403).json({ ok: false, error: 'Not an HR account' });

    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ ok: false, error: 'COGNITO_CLIENT_ID not configured' });
    }

    // Complete Cognito NEW_PASSWORD_REQUIRED challenge
    const init = await Cognito.initiateAuth({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: { USERNAME: email_address, PASSWORD: temp_password }
    }).promise().catch(e => { throw e; });

    const challengeName = init.ChallengeName;
    const session = init.Session;
    if (challengeName && challengeName !== 'NEW_PASSWORD_REQUIRED') {
      return res.status(400).json({ ok: false, error: `Unexpected Cognito challenge: ${challengeName}` });
    }
    if (challengeName === 'NEW_PASSWORD_REQUIRED') {
      await Cognito.respondToAuthChallenge({
        ClientId: clientId,
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: session,
        ChallengeResponses: { USERNAME: email_address, NEW_PASSWORD: new_password }
      }).promise();
    }

    // Update local password
    const hashedNewPassword = await bcrypt.hash(new_password, 10);
    const updateParams = {
      TableName: userModel.tableName,
      Key: { id: user.id, email_address: user.email_address },
      UpdateExpression: 'set #p = :password, #ua = :updated_at',
      ExpressionAttributeNames: { '#p': 'password', '#ua': 'updated_at' },
      ExpressionAttributeValues: { ':password': hashedNewPassword, ':updated_at': moment.utc().toISOString() }
    };
    await Dynamo.update(updateParams).promise();

    return res.json({ ok: true, message: 'Password set successfully' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

async function listHR(req, res) {
  try {
    // 1) AuthZ via Cognito: ensure requester is company_admin
    const auth = req.headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: 'Missing bearer token' });

    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!userPoolId || !clientId) {
      return res.status(500).json({ ok: false, error: 'Cognito env not configured' });
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
          return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
        }
      }
    }

    const username = payload['cognito:username'] || payload['username'] || payload['email'];
    if (!username) {
      return res.status(401).json({ ok: false, error: 'Unable to resolve requester identity' });
    }

    // Get admin user details
    const adminUser = await Cognito.adminGetUser({ UserPoolId: userPoolId, Username: username }).promise();
    const attrs = adminUser.UserAttributes || [];
    const roleAttr = attrs.find(a => a.Name === 'custom:role');
    const role = String(roleAttr?.Value || '').toLowerCase();
    if (role !== 'company_admin') {
      return res.status(403).json({ ok: false, error: 'Only company admin can view HR list' });
    }

    // Get company_id of the company admin from tb_users
    const adminEmail = attrs.find(a => a.Name === 'email')?.Value;
    if (!adminEmail) {
      return res.status(400).json({ ok: false, error: 'Admin email not found' });
    }

    const adminUserData = await Dynamo.scan({
      TableName: userModel.tableName,
      FilterExpression: '#e = :email',
      ExpressionAttributeNames: { '#e': 'email_address' },
      ExpressionAttributeValues: { ':email': adminEmail }
    }).promise();
    
    const adminData = (adminUserData.Items || [])[0];
    if (!adminData || !adminData.company_id) {
      return res.status(400).json({ ok: false, error: 'Company admin not found or not associated with any company' });
    }
    const company_id = adminData.company_id;

    // 2) Get HR user IDs from tb_users where user_role is 'hr' and matching company_id
    const hrUsers = await Dynamo.scan({
      TableName: userModel.tableName,
      FilterExpression: '#role = :role AND #company = :company_id',
      ExpressionAttributeNames: {
        '#role': 'user_role',
        '#company': 'company_id'
      },
      ExpressionAttributeValues: {
        ':role': 'hr',
        ':company_id': company_id
      }
    }).promise();

    const hrIds = (hrUsers.Items || []).map(user => user.id);
    if (!hrIds.length) {
      return res.json({ ok: true, data: [] });
    }

    // 3) Get HR details from tb_hr_details where hr_id matches the retrieved IDs
    const hrDetails = await Dynamo.scan({
      TableName: process.env.DDB_HR_DETAILS_TABLE || 'tb_hr_details',
      FilterExpression: '#hr_id IN (' + hrIds.map((_, i) => `:id${i}`).join(',') + ')',
      ExpressionAttributeNames: { '#hr_id': 'hr_id' },
      ExpressionAttributeValues: hrIds.reduce((acc, id, i) => ({ ...acc, [`:id${i}`]: id }), {})
    }).promise();

    const hrList = (hrDetails.Items || []).map(item => ({
      id: item.id,
      hr_id: item.hr_id,
      full_name: (hrUsers.Items.find(user => user.id === item.hr_id) || {}).full_name || 'N/A',
      email_address: (hrUsers.Items.find(user => user.id === item.hr_id) || {}).email_address || 'N/A',
      department: item.department,
      designation: item.designation,
      employee_id: item.employee_id,
      joining_date: item.joining_date,
      linkedIn_url: item.linkedIn_url,
      phone_number: item.phone_number,
      reporting_manager: item.reporting_manager,
      status: item.status,
      work_location: item.work_location,
      created_at: item.created_at,
      created_by: item.created_by,
      updated_at: item.updated_at,
      updated_by: item.updated_by
    }));

    return res.json({ ok: true, data: hrList });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

module.exports = { inviteHR, setHRPassword, listHR };