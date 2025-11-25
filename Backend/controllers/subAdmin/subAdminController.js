const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const bcrypt = require('bcryptjs');

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { Cognito, Dynamo } = require('../../config/AWS.js');
const userModel = require('../../models/userModel');

function generateTempPassword() {
  // Generate a password that meets typical Cognito policies:
  // at least 1 uppercase, 1 lowercase, 1 number, 1 special, length >= 12
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const special = '@#$%&*!?';
  const all = upper + lower + nums + special;

  function pick(str) { return str[Math.floor(Math.random() * str.length)]; }

  while (true) {
    const required = [pick(upper), pick(lower), pick(nums), pick(special)];
    const restLen = 12 - required.length; // ensure min length 12
    const rest = Array.from({ length: restLen }, () => pick(all));
    const pwdArr = [...required, ...rest];
    // shuffle
    for (let i = pwdArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pwdArr[i], pwdArr[j]] = [pwdArr[j], pwdArr[i]];
    }
    const pwd = pwdArr.join('');
    // Double-check with regexes
    if (
      /[A-Z]/.test(pwd) &&
      /[a-z]/.test(pwd) &&
      /[0-9]/.test(pwd) &&
      /[@#$%&*!?]/.test(pwd) &&
      pwd.length >= 12
    ) {
      return pwd;
    }
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

// POST /invite-subadmin
// Body: { email_address, full_name }
async function inviteSubAdmin(req, res) {
  try {
    // 0) AuthZ via Cognito: ensure requester is super admin
    const auth = req.headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: 'Missing bearer token' });

    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!userPoolId || !clientId) {
      return res.status(500).json({ ok: false, error: 'Cognito env not configured' });
    }

    let payload;
    // Try verify as ID token first
    try {
      const idVerifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
      payload = await idVerifier.verify(token);
    } catch (_) {
      // Fallback: try as access token
      try {
        // clientId is not required for access tokens
        const accessVerifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: 'access' });
        payload = await accessVerifier.verify(token);
      } catch (e2) {
        // Final fallback: verify local app JWT
        try {
          const jwt = require('jsonwebtoken');
          payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
          payload.__source = 'app';
        } catch (e3) {
          return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
        }
      }
    }

    // Fetch user from Cognito to read custom:role
    const username = payload['cognito:username'] || payload['username'] || payload['email'];
    if (!username) {
      return res.status(401).json({ ok: false, error: 'Unable to resolve requester identity' });
    }

    const adminUser = await Cognito.adminGetUser({ UserPoolId: userPoolId, Username: username }).promise();
    const attrs = adminUser.UserAttributes || [];
    const roleAttr = attrs.find(a => a.Name === 'custom:role');
    const role = String(roleAttr?.Value || '').toLowerCase();
    if (!['super_admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ ok: false, error: 'Only super admin can invite sub-admins' });
    }

    const { email_address, full_name } = req.body || {};
    if (!email_address || !full_name) {
      return res.status(400).json({ ok: false, error: 'email_address and full_name are required' });
    }

    const existing = await getUserByEmail(email_address);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'User already exists with this email' });
    }

    const id = uuidv4();
    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    const nowIso = moment.utc().toISOString();

    // 1) Create user in Cognito which will send the invitation email
    // userPoolId already validated above
    // Attempt to create user in Cognito; if password policy fails, regenerate once and retry
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
          { Name: 'custom:role', Value: 'sub_admin' }
        ]
      }).promise();
    } catch (e) {
      if (e.code === 'InvalidPasswordException') {
        // regenerate and retry once
        const retryTemp = generateTempPassword();
        const retryHashed = await bcrypt.hash(retryTemp, 10);
        await Cognito.adminCreateUser({
          UserPoolId: userPoolId,
          Username: email_address,
          TemporaryPassword: retryTemp,
          DesiredDeliveryMediums: ['EMAIL'],
          ForceAliasCreation: false,
          UserAttributes: [
            { Name: 'email', Value: email_address },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: full_name },
            { Name: 'custom:role', Value: 'sub_admin' }
          ]
        }).promise();
        // override temp password stored locally with the retry password
        // update hashed variable for storing in Dynamo below
        // Note: to keep minimal changes, reassign hashed and tempPassword via block scoping here is not trivial.
        // We'll carry retry values by redefining variables
        var tempPasswordOverride = retryTemp;
        var hashedOverride = retryHashed;
        // Assign to outer variables by using them later if defined
        tempPassword = tempPasswordOverride;
        hashed = hashedOverride;
      } else {
        throw e;
      }
    }

    // 2) Store user in DynamoDB (including hashed temp password to support local validation)
    const item = userModel.buildItem({
      id,
      full_name,
      email_address,
      company_id: null,
      created_at: nowIso,
      created_by: username || 'super_admin',
      updated_at: nowIso,
      updated_by: username || 'super_admin',
      user_role: 'sub_admin',
      status: 1,
      password: hashed,
      active_status: 'Active'
    });

    await putItem(userModel.tableName, item);

    return res.json({ ok: true, message: 'Sub-admin invited successfully' });
  } catch (error) {
    const code = error.code === 'ConditionalCheckFailedException' ? 409 : 500;
    return res.status(code).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

// POST /set-subadmin-password
// Body: { email_address, temp_password, new_password, confirm_new_password }
async function setSubAdminPassword(req, res) {
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
    if (user.user_role !== 'sub_admin') return res.status(403).json({ ok: false, error: 'Not a sub-admin account' });

    // 1) Complete Cognito NEW_PASSWORD_REQUIRED flow using temp password
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ ok: false, error: 'COGNITO_CLIENT_ID not configured' });
    }

    // a) Initiate auth with temp password
    const init = await Cognito.initiateAuth({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: {
        USERNAME: email_address,
        PASSWORD: temp_password
      }
    }).promise().catch(e => {
      // If the temp password is invalid, Cognito will throw NotAuthorizedException
      throw e;
    });

    const challengeName = init.ChallengeName;
    const session = init.Session;
    if (challengeName && challengeName !== 'NEW_PASSWORD_REQUIRED') {
      // If no challenge, temp password was already changed; we still allow update locally after validation below
      // But if some other challenge, return error
      return res.status(400).json({ ok: false, error: `Unexpected Cognito challenge: ${challengeName}` });
    }

    if (challengeName === 'NEW_PASSWORD_REQUIRED') {
      await Cognito.respondToAuthChallenge({
        ClientId: clientId,
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: session,
        ChallengeResponses: {
          USERNAME: email_address,
          NEW_PASSWORD: new_password
        }
      }).promise();
    }

    // 2) Hash new password and update locally in DynamoDB
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

    return res.json({ ok: true, message: 'Password set successfully' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.name || 'InternalError', message: error.message });
  }
}

module.exports = { inviteSubAdmin, setSubAdminPassword };
