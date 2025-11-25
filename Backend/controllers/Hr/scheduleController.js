const { Dynamo, Cognito } = require('../../config/AWS');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const { sendEmail } = require('../../utils/email');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

// Helper function to generate temporary password that meets Cognito requirements
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

// Helper function to get user by email
async function getUserByEmail(email_address) {
  const params = {
    TableName: 'tb_users',
    FilterExpression: '#e = :email',
    ExpressionAttributeNames: { '#e': 'email_address' },
    ExpressionAttributeValues: { ':email': email_address }
  };
  const out = await Dynamo.scan(params).promise();
  return (out.Items || [])[0] || null;
}

// Helper function to put item in DynamoDB with condition
async function putItem(tableName, item) {
  await Dynamo.put({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(id)' }).promise();
}

// Middleware to verify JWT token and HR role
const verifyTokenAndRole = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        ok: false, 
        error: 'Access denied. No token provided.' 
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    
    // Check if user has HR role
    if (decoded.role !== 'hr') {
      return res.status(403).json({ 
        ok: false, 
        error: 'Access denied. HR role required.' 
      });
    }

    // Attach the decoded user to the request object
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        ok: false, 
        error: 'Session expired. Please log in again.' 
      });
    }
    res.status(401).json({ 
      ok: false, 
      error: 'Invalid token' 
    });
  }
};

/**
 * POST /api/hr/schedule-interview
 * Headers: {
 *   Authorization: Bearer <token>
 * }
 * Body: {
 *   candidates: [
 *     {
 *       email: string,
 *       name: string
 *     }
 *   ],
 *   interviewDetails: object
 * }
 */
async function scheduleInterview(req, res) {
  try {
    // 1) AuthZ via Cognito: ensure requester is HR
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

    // Extract HR details from token payload
    const hrEmail = payload['email'] || payload['cognito:username'] || payload['username'];
    const hrRole = payload['custom:role'] || payload['role'];
    
    if (!hrEmail) {
      return res.status(401).json({ ok: false, error: 'Unable to resolve HR email from token' });
    }

    if (!hrRole || String(hrRole).toLowerCase() !== 'hr') {
      return res.status(403).json({ ok: false, error: 'Only HR can schedule interviews' });
    }

    // Get HR's company_id from tb_users table
    const hrUserData = await getUserByEmail(hrEmail);
    if (!hrUserData || !hrUserData.company_id) {
      return res.status(400).json({ ok: false, error: 'HR not found or not associated with any company' });
    }
    const company_id = hrUserData.company_id;
    const hrId = hrUserData.id;

    // 2) Validate payload
    const { candidates, interviewDetails } = req.body || {};
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'candidates array is required with at least one candidate'
      });
    }

    // Validate each candidate object
    for (const candidate of candidates) {
      if (!candidate.email || !candidate.name) {
        return res.status(400).json({
          ok: false,
          error: 'Each candidate must have both email and name fields'
        });
      }
    }

    // 3) Process each candidate
    const results = [];
    const nowIso = moment.utc().toISOString();

    for (const candidate of candidates) {
      const { email, name } = candidate;
      try {
        // Check if user already exists
        const existing = await getUserByEmail(email);
        if (existing) {
          results.push({
            email,
            name,
            success: false,
            error: 'User already exists with this email'
          });
          continue;
        }

        const id = uuidv4();
        let tempPassword = generateTempPassword();
        let hashed = await bcrypt.hash(tempPassword, 10);

        // 4) Create user in DynamoDB first
        const userItem = {
          id,
          full_name: name, // Using provided name
          email_address: email.toLowerCase().trim(),
          company_id,
          created_at: nowIso,
          created_by: hrId,
          updated_at: nowIso,
          updated_by: hrId,
          user_role: 'candidate',
          status: '1',
          active_status: 'Active',
          password: hashed
        };

        await putItem('tb_users', userItem);

        // 5) Create user in Cognito and trigger email
        try {
          await Cognito.adminCreateUser({
            UserPoolId: userPoolId,
            Username: email,
            TemporaryPassword: tempPassword,
            DesiredDeliveryMediums: ['EMAIL'],
            ForceAliasCreation: false,
            UserAttributes: [
              { Name: 'email', Value: email },
              { Name: 'email_verified', Value: 'true' },
              { Name: 'name', Value: name },
              { Name: 'custom:role', Value: 'candidate' }
            ]
          }).promise();
        } catch (e) {
          if (e.code === 'InvalidPasswordException') {
            tempPassword = generateTempPassword();
            hashed = await bcrypt.hash(tempPassword, 10);
            
            // Update DynamoDB with new password
            await Dynamo.update({
              TableName: 'tb_users',
              Key: { id },
              UpdateExpression: 'set #p = :password',
              ExpressionAttributeNames: { '#p': 'password' },
              ExpressionAttributeValues: { ':password': hashed }
            }).promise();

            await Cognito.adminCreateUser({
              UserPoolId: userPoolId,
              Username: email,
              TemporaryPassword: tempPassword,
              DesiredDeliveryMediums: ['EMAIL'],
              ForceAliasCreation: false,
              UserAttributes: [
                { Name: 'email', Value: email },
                { Name: 'email_verified', Value: 'true' },
                { Name: 'name', Value: name },
                { Name: 'custom:role', Value: 'candidate' },
                
              ]
            }).promise();
          } else {
            throw e;
          }
        }

        // 6) Send custom email notification with login credentials
        try {
          const emailSubject = 'Interview Invitation - Login Credentials';
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">Interview Invitation</h2>
              <p>Dear ${name},</p>
              <p>You have been invited for an interview. Please use the following credentials to access the system:</p>
              <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Temporary Password:</strong> ${tempPassword}</p>
              </div>
              <p><strong>Important:</strong> Please change your password after your first login for security purposes.</p>
              <p>Best regards,<br>HR Team</p>
            </div>
          `;

          await sendEmail({
            to: email,
            subject: emailSubject,
            html: emailHtml
          });
        } catch (emailError) {
          console.error(`Failed to send email to ${email}:`, emailError);
          // Don't fail the entire operation if email fails
        }

        results.push({
          email,
          name,
          success: true,
          userId: id,
          temporaryPassword: tempPassword
        });

      } catch (error) {
        console.error(`Error processing candidate ${email}:`, error);
        results.push({
          email,
          name,
          success: false,
          error: error.message
        });
      }
    }

    // 7) Check results and return response
    const allSuccess = results.every(r => r.success);
    const someSuccess = results.some(r => r.success);
    
    if (!someSuccess) {
      return res.status(500).json({
        ok: false,
        message: 'Failed to schedule interviews for any candidates',
        results
      });
    }

    const response = {
      ok: true,
      message: allSuccess ? 'All candidates invited successfully' : 'Some candidates invited successfully',
      results: results.map(r => ({
        email: r.email,
        name: r.name,
        success: r.success,
        userId: r.userId,
        temporaryPassword: r.temporaryPassword || undefined,
        error: r.error || undefined
      }))
    };

    res.json(response);

  } catch (error) {
    console.error('Error in scheduleInterview:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

module.exports = {
  scheduleInterview
};
