// Simple test endpoint for debugging authentication
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Test authentication endpoint
app.get('/test-auth', async (req, res) => {
  try {
    const auth = req.headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    
    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Missing token',
        message: 'Authorization header with Bearer token is required'
      });
    }

    console.log('🔍 Testing token:', token.substring(0, 20) + '...');
    
    // Check environment
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    
    if (!userPoolId || !clientId) {
      return res.status(500).json({
        ok: false,
        error: 'Configuration missing',
        message: 'Cognito configuration not found in environment variables'
      });
    }

    // Try to decode token manually first
    try {
      const [headerB64, payloadB64] = token.split('.');
      const header = JSON.parse(Buffer.from(headerB64, 'base64').toString());
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
      
      return res.json({
        ok: true,
        message: 'Token decoded successfully',
        data: {
          tokenType: payload.token_use,
          hasKid: !!header.kid,
          username: payload['cognito:username'] || payload.username,
          email: payload.email,
          expires: new Date(payload.exp * 1000).toISOString(),
          environment: {
            userPoolId: userPoolId ? 'Set' : 'Missing',
            clientId: clientId ? 'Set' : 'Missing'
          }
        }
      });
    } catch (decodeError) {
      return res.status(400).json({
        ok: false,
        error: 'Token decode failed',
        message: decodeError.message
      });
    }

  } catch (error) {
    console.error('Test auth error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal error',
      message: error.message
    });
  }
});

const PORT = 4001;
app.listen(PORT, () => {
  console.log(`🧪 Auth test server running on port ${PORT}`);
  console.log(`Test endpoint: http://localhost:${PORT}/test-auth`);
  console.log('Send a GET request with Authorization: Bearer <your-token>');
});
