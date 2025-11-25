const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { Cognito, Dynamo } = require('../config/AWS');
const companyModel = require('../models/companyModel');
const userModel = require('../models/userModel');
const loginLogModel = require('../models/loginLogModel');

function validatePayload(body) {
  const required = ['full_name', 'email_address', 'password', 'confirmPassword', 'user_role', 'company_name', 'company_location', 'company_size'];
  for (const key of required) {
    if (!body[key]) return `${key} is required`;
  }
  if (body.password !== body.confirmPassword) return 'password and confirmPassword must match';
  if (typeof body.email_address !== 'string' || !body.email_address.includes('@')) return 'email_address is invalid';
  return null;
}



async function signUpInCognito({ email_address, password, user_role, full_name }) {
  const params = {
    ClientId: process.env.COGNITO_CLIENT_ID,
    Username: email_address,
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email_address },
      { Name: 'name', Value: full_name },
      { Name: 'custom:role', Value: user_role }
    ]
  };
  // Cognito will automatically send verification OTP to email upon successful sign up
  return Cognito.signUp(params).promise();
}

async function putItem(tableName, item) {
  await Dynamo.put({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(id)' }).promise();
}

// Helper: fetch user by email_address (scan fallback)
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

// Helper: check if user is verified in Cognito
async function isCognitoUserVerified(email_address) {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) return false;
  try {
    const resp = await Cognito.adminGetUser({ UserPoolId: userPoolId, Username: email_address }).promise();
    const status = resp.UserStatus; // e.g., CONFIRMED
    const attrs = resp.UserAttributes || [];
    const emailVerified = attrs.find(a => a.Name === 'email_verified')?.Value === 'true';
    return status === 'CONFIRMED' && emailVerified;
  } catch (e) {
    return false;
  }
}

// Helper: issue JWT with 90 days expiry
function issueToken(payload) {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return jwt.sign(payload, secret, { expiresIn: '90d' });
}

// POST /login
async function login(req, res) {
  try {
    const { email_address, password } = req.body || {};
    if (!email_address || !password) {
      return res.status(400).json({ ok: false, error: 'email_address and password are required' });
    }

    // First get the user to check their role
    const user = await getUserByEmail(email_address);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    
    // Check user status
    if (user.status && String(user.status) !== '1') {
      return res.status(403).json({ ok: false, error: 'User is inactive' });
    }

    // For HR, sub_admin, and candidate users, check with Cognito first for temporary password
    if (['hr', 'sub_admin', 'candidate'].includes(user.user_role?.toLowerCase())) {
      try {
        const clientId = process.env.COGNITO_CLIENT_ID;
        if (clientId) {
          // Try to authenticate with Cognito to check for temporary password
          const cognitoResponse = await Cognito.initiateAuth({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: clientId,
            AuthParameters: {
              USERNAME: email_address,
              PASSWORD: password
            }
          }).promise();

          // If we get NEW_PASSWORD_REQUIRED challenge, it means they're using temporary password
          if (cognitoResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
            return res.status(200).json({
              ok: true,
              requires_password_change: true,
              message: 'Temporary password detected. Please change your password.',
              user_details: {
                user_id: user.id,
                email: user.email_address,
                user_role: user.user_role,
                temp_password: password // Pass the temp password for the change password screen
              }
            });
          }
          
          // If Cognito auth succeeds without challenge, password is already changed
          // Continue with normal login flow
        }
      } catch (cognitoError) {
        // If Cognito auth fails, check if it's because password is already changed
        // In that case, fall back to local password validation
        console.log('Cognito auth failed, checking local password:', cognitoError.message);
      }
    }
    
    // Only verify Cognito email verification for roles other than hr, sub_admin, and candidate
    if (!['hr', 'sub_admin', 'candidate'].includes(user.user_role?.toLowerCase())) {
      const verified = await isCognitoUserVerified(email_address);
      if (!verified) {
        return res.status(403).json({ ok: false, error: 'Email not verified in Cognito. Please verify before login.' });
      }
    }

    // Validate password locally
    const okPwd = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!okPwd) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

    // 3) Issue JWT for 90 days
    const nowIso = moment.utc().toISOString();
    const tokenPayload = { user_id: user.id, email: user.email_address, role: user.user_role };
    const token = issueToken(tokenPayload);

    // 4) Log login
    const logItem = loginLogModel.buildItem({
      id: uuidv4(),
      user_id: user.id,
      login_at: nowIso,
      email_address: user.email_address,
      token,
      user_role: user.user_role,
      status: 1,
      created_at: nowIso,
      created_by: user.id,
      updated_at: nowIso,
      updated_by: user.id
    });
    await putItem(loginLogModel.tableName, logItem);

    return res.json({
      ok: true,
      user_details: {
        user_id: user.id,
        email: user.email_address,
        user_role: user.user_role,
        logined_at: nowIso
      },
      token
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

// POST /renew-session
// Body: { token, confirm_extend: boolean }
async function renewSession(req, res) {
  try {
    const { token, confirm_extend } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: 'token is required' });

    const secret = process.env.JWT_SECRET || 'dev-secret';
    let decoded;
    try {
      decoded = jwt.verify(token, secret, { ignoreExpiration: true });
    } catch (e) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }

    // Check if user is still active
    const user = await getUserByEmail(decoded.email);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    if (user.status && String(user.status) !== '1') return res.status(403).json({ ok: false, error: 'User is inactive' });

    // Determine remaining time; if expired beyond 90d and not confirmed, ask to confirm
    // Here we implement sliding extension: if confirm_extend === true, issue new token
    if (confirm_extend === true) {
      const newToken = issueToken({ user_id: user.id, email: user.email_address, role: user.user_role });
      const nowIso = moment.utc().toISOString();

      const logItem = loginLogModel.buildItem({
        id: uuidv4(),
        user_id: user.id,
        login_at: nowIso,
        email_address: user.email_address,
        token: newToken,
        user_role: user.user_role,
        status: 1,
        created_at: nowIso,
        created_by: user.id,
        updated_at: nowIso,
        updated_by: user.id
      });
      await putItem(loginLogModel.tableName, logItem);

      return res.json({ ok: true, message: 'Session extended', token: newToken });
    }

    return res.status(200).json({ ok: false, message: 'Session nearing expiry. Confirm to continue.' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

async function registerCompany(req, res) {
  try {
    const err = validatePayload(req.body || {});
    if (err) return res.status(400).json({ ok: false, error: err });

    const { full_name, email_address, password, user_role, company_name, company_location, company_size } = req.body;

    // Register user in Cognito (sends OTP automatically)
    await signUpInCognito({ email_address, password, user_role, full_name });
    // At this point, Cognito will send a verification email to the user automatically.
    // No further action is needed to trigger the verification email.

    const nowIso = moment.utc().toISOString();
    const userId = uuidv4();
    const companyId = uuidv4();

    const hashedPassword = await bcrypt.hash(password, 10);

    const userItem = userModel.buildItem({
      id: userId,
      full_name,
      email_address,
      company_id: companyId,
      created_at: nowIso,
      created_by: userId,
      updated_at: nowIso,
      updated_by: userId,
      user_role: user_role,
      status: '1',
      password: hashedPassword,
      active_status: 'Active'
    });

    const companyItem = companyModel.buildItem({
      id: companyId,
      email_address: email_address,
      company_size,
      company_location,
      company_name,
      created_at: nowIso,
      created_by: userId,
      updated_at: nowIso,
      updated_by: userId,
      status: '1',
      active_status: 'Active'
    });

    await putItem(companyModel.tableName, companyItem);
    await putItem(userModel.tableName, userItem);

    return res.status(201).json({ ok: true, message: 'Company registered. Verification OTP sent to email.', company_id: companyId, user_id: userId });
  } catch (error) {
    const code = error.code || error.name;
    return res.status(500).json({ ok: false, error: code || 'InternalError', message: error.message });
  }
}

// Send Cognito confirmation code (OTP) to user's email (resend)
async function sendVerificationOTP(req, res) {
  try {
    const { email_address } = req.body;
    if (!email_address || typeof email_address !== 'string') {
      return res.status(400).json({ ok: false, error: 'email_address is required' });
    }

    const params = {
      ClientId: process.env.COGNITO_CLIENT_ID,
      Username: email_address
    };

    await Cognito.resendConfirmationCode(params).promise();

    return res.json({ ok: true, message: 'OTP resent to email via Cognito' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

// Verify OTP using Cognito
async function verifyOTP(req, res) {
  try {
    const { email_address, otp } = req.body;
    if (!email_address || !otp) {
      return res.status(400).json({ ok: false, error: 'email_address and otp are required' });
    }

    const params = {
      ClientId: process.env.COGNITO_CLIENT_ID,
      Username: email_address,
      ConfirmationCode: otp
    };

    await Cognito.confirmSignUp(params).promise();

    // Optionally, update user status in your DB if needed

    return res.json({ ok: true, message: 'Email verified successfully via Cognito' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

function validateResetPasswordPayload(body) {
  const required = ['email_address', 'old_password', 'new_password', 'confirm_new_password'];
  for (const key of required) {
    if (!body[key]) return `${key} is required`;
  }
  if (body.new_password !== body.confirm_new_password) return 'new_password and confirm_new_password must match';
  return null;
}

function validateCandidatePayload(body) {
  const required = ['fullname', 'email_address', 'password', 'confirmPassword', 'user_role'];
  for (const key of required) {
    if (!body[key]) return `${key} is required`;
  }
  if (body.password !== body.confirmPassword) return 'password and confirmPassword must match';
  if (typeof body.email_address !== 'string' || !body.email_address.includes('@')) return 'email_address is invalid';
  return null;
}

async function registerCandidate(req, res) {
  try {
    const err = validateCandidatePayload(req.body || {});
    if (err) return res.status(400).json({ ok: false, error: err });

    const { fullname, email_address, password, user_role } = req.body;

    // Register user in Cognito (sends verification email automatically)
    await signUpInCognito({
      email_address,
      password,
      user_role,
      full_name: fullname
    });

    const nowIso = moment.utc().toISOString();
    const userId = uuidv4();

    const hashedPassword = await bcrypt.hash(password, 10);

    const userItem = userModel.buildItem({
      id: userId,
      full_name: fullname,
      email_address,
      company_id: null,
      created_at: nowIso,
      created_by: userId,
      updated_at: nowIso,
      updated_by: userId,
      user_role: user_role,
      status: '1',
      password: hashedPassword
    });

    await putItem(userModel.tableName, userItem);

    return res.status(201).json({ ok: true, message: 'Candidate registered. Verification email sent by Cognito.', user_id: userId });
  } catch (error) {
    const code = error.code || error.name;
    return res.status(500).json({ ok: false, error: code || 'InternalError', message: error.message });
  }
}

// POST /logout
async function logout(req, res) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(400).json({ ok: false, error: 'Authorization header with Bearer token is required' });
    }
    const token = authHeader.split(' ')[1];

    // Check token in tb_login_log
    const params = {
      TableName: loginLogModel.tableName,
      FilterExpression: '#t = :token AND #s = :status',
      ExpressionAttributeNames: {
        '#t': 'token',
        '#s': 'status'
      },
      ExpressionAttributeValues: {
        ':token': token,
        ':status': 1
      }
    };
    const result = await Dynamo.scan(params).promise();
    const logEntry = (result.Items || [])[0];
    if (!logEntry) return res.status(404).json({ ok: false, error: 'Active login session not found' });

    // Update status to 0
    const updateParams = {
      TableName: loginLogModel.tableName,
      Key: {
        id: logEntry.id,
        user_id: logEntry.user_id // Include sort key
      },
      UpdateExpression: 'SET #s = :status, updated_at = :updated_at, updated_by = :updated_by',
      ExpressionAttributeNames: {
        '#s': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 0,
        ':updated_at': moment.utc().toISOString(),
        ':updated_by': logEntry.user_id
      }
    };
    await Dynamo.update(updateParams).promise();

    // Invalidate Cognito session
    try {
      await Cognito.adminUserGlobalSignOut({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: logEntry.email_address
      }).promise();
    } catch (e) {
      console.error('Cognito sign-out error:', e.message);
      // Continue even if Cognito sign-out fails
    }

    return res.json({ ok: true, message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

async function resetPassword(req, res) {
  try {
    // 1. Validate payload
    const err = validateResetPasswordPayload(req.body || {});
    if (err) return res.status(400).json({ ok: false, error: err });

    const { email_address, old_password, new_password } = req.body;

    // 2. Fetch user and verify old password
    const user = await getUserByEmail(email_address);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });

    const isMatch = await bcrypt.compare(old_password, user.password);
    if (!isMatch) return res.status(401).json({ ok: false, error: 'Invalid old password' });

    // 3. Set the new password in Cognito directly (as admin)
    // This is used because the local DB password and Cognito password can be out of sync.
    // Since we've already verified the user's old password against our local DB,
    // we can proceed with an admin action to reset the password in Cognito.
    await Cognito.adminSetUserPassword({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: email_address,
      Password: new_password,
      Permanent: true
    }).promise();

    // 4. Hash new password and update in DynamoDB
    const hashedNewPassword = await bcrypt.hash(new_password, 10);
    const updateParams = {
      TableName: userModel.tableName,
      Key: { 
        id: user.id,
        email_address: user.email_address
      },
      UpdateExpression: 'set #p = :password, #ua = :updated_at',
      ExpressionAttributeNames: { '#p': 'password', '#ua': 'updated_at' },
      ExpressionAttributeValues: {
        ':password': hashedNewPassword,
        ':updated_at': moment.utc().toISOString()
      }
    };
    await Dynamo.update(updateParams).promise();

    return res.json({ ok: true, message: 'Password reset successfully' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

// Generate a 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function forgotPassword(req, res) {
  try {
    const { email_address } = req.body;
    if (!email_address) {
      return res.status(400).json({ ok: false, error: 'Email address is required' });
    }

    // We don't check if the user exists first to prevent user enumeration attacks.
    // Cognito will handle this gracefully.
    await Cognito.forgotPassword({
      ClientId: process.env.COGNITO_CLIENT_ID,
      Username: email_address
    }).promise();

    return res.json({ ok: true, message: 'If an account with that email exists, a password reset code has been sent.' });

  } catch (error) {
    // Even if Cognito throws UserNotFoundException, we return a generic success message.
    if (error.name === 'UserNotFoundException') {
      return res.json({ ok: true, message: 'If an account with that email exists, a password reset code has been sent.' });
    }
    return res.status(500).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

async function confirmForgotPassword(req, res) {
  try {
    const { email_address, confirmation_code, new_password, confirm_new_password } = req.body;

    // 1. Basic validation
    if (!email_address || !confirmation_code || !new_password || !confirm_new_password) {
      return res.status(400).json({ ok: false, error: 'Email, confirmation code, and new password are required' });
    }
    if (new_password !== confirm_new_password) {
      return res.status(400).json({ ok: false, error: 'New passwords do not match' });
    }

    // 2. Confirm the new password in Cognito
    await Cognito.confirmForgotPassword({
      ClientId: process.env.COGNITO_CLIENT_ID,
      Username: email_address,
      ConfirmationCode: confirmation_code,
      Password: new_password
    }).promise();

    // 3. Hash the new password and update it in the local DynamoDB
    const user = await getUserByEmail(email_address);
    if (!user) {
      // This case is unlikely if Cognito succeeded, but it's good practice to handle it.
      return res.status(404).json({ ok: false, error: 'User not found in local database' });
    }

    const hashedNewPassword = await bcrypt.hash(new_password, 10);
    const updateParams = {
      TableName: userModel.tableName,
      Key: {
        id: user.id,
        email_address: user.email_address
      },
      UpdateExpression: 'set #p = :password, #ua = :updated_at',
      ExpressionAttributeNames: { '#p': 'password', '#ua': 'updated_at' },
      ExpressionAttributeValues: {
        ':password': hashedNewPassword,
        ':updated_at': moment.utc().toISOString()
      }
    };
    await Dynamo.update(updateParams).promise();

    return res.json({ ok: true, message: 'Password has been reset successfully.' });

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

module.exports = {
  registerCompany,
  sendVerificationOTP,
  verifyOTP,
  registerCandidate,
  login,
  renewSession,
  logout,
  resetPassword,
  forgotPassword,
  confirmForgotPassword
};




