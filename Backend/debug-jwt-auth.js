// Debug script for JWT authentication issues
const { CognitoJwtVerifier } = require('aws-jwt-verify');

async function debugJWTToken(token) {
  console.log('🔍 Debugging JWT Token...\n');
  
  if (!token) {
    console.log('❌ No token provided');
    console.log('Usage: node debug-jwt-auth.js <your-jwt-token>');
    return;
  }

  console.log('📋 Token Info:');
  console.log('- Token length:', token.length);
  console.log('- Token starts with:', token.substring(0, 20) + '...');
  console.log('');

  // Check environment variables
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  
  console.log('🔧 Environment Configuration:');
  console.log('- COGNITO_USER_POOL_ID:', userPoolId ? '✅ Set' : '❌ Missing');
  console.log('- COGNITO_CLIENT_ID:', clientId ? '✅ Set' : '❌ Missing');
  console.log('');

  if (!userPoolId || !clientId) {
    console.log('❌ Missing Cognito configuration. Please check your .env file.');
    console.log('Required variables:');
    console.log('- COGNITO_USER_POOL_ID');
    console.log('- COGNITO_CLIENT_ID');
    return;
  }

  // Try to decode the JWT header to check token structure
  try {
    const [headerB64, payloadB64, signature] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64').toString());
    
    console.log('🔑 JWT Header:');
    console.log(JSON.stringify(header, null, 2));
    console.log('');

    if (!header.kid) {
      console.log('⚠️  WARNING: JWT header missing "kid" claim');
      console.log('This is likely the cause of your authentication error.');
    } else {
      console.log('✅ JWT header has "kid" claim:', header.kid);
    }
    
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    console.log('📄 JWT Payload:');
    console.log('- Token Use:', payload.token_use);
    console.log('- Issuer:', payload.iss);
    console.log('- Audience:', payload.aud);
    console.log('- Expires:', new Date(payload.exp * 1000));
    console.log('- Username:', payload['cognito:username'] || payload.username);
    console.log('');

  } catch (decodeError) {
    console.log('❌ Failed to decode JWT token:', decodeError.message);
    return;
  }

  // Try token verification
  console.log('🔐 Testing Token Verification:');
  
  try {
    const verifier = CognitoJwtVerifier.create({ 
      userPoolId, 
      clientId, 
      tokenUse: 'id' 
    });
    const payload = await verifier.verify(token);
    console.log('✅ ID Token verification successful!');
    console.log('User info:', {
      username: payload['cognito:username'] || payload.username,
      email: payload.email,
      role: payload['custom:role']
    });
  } catch (idError) {
    console.log('❌ ID Token verification failed:', idError.message);
    
    try {
      const accessVerifier = CognitoJwtVerifier.create({ 
        userPoolId, 
        clientId, 
        tokenUse: 'access' 
      });
      const payload = await accessVerifier.verify(token);
      console.log('✅ Access Token verification successful!');
      console.log('User info:', {
        username: payload.username,
        scope: payload.scope
      });
    } catch (accessError) {
      console.log('❌ Access Token verification also failed:', accessError.message);
      console.log('');
      console.log('🔧 Troubleshooting Tips:');
      console.log('1. Make sure your token is not expired');
      console.log('2. Verify the COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are correct');
      console.log('3. Check if the token was issued by the correct Cognito User Pool');
      console.log('4. Ensure the token type (ID vs Access) matches your verification attempt');
    }
  }
}

// Get token from command line argument
const token = process.argv[2];
debugJWTToken(token);
