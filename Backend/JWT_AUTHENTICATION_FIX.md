# JWT Authentication Fix for Company Analytics API

## Problem
You're encountering the error: `"JWT header does not have valid kid claim"`

This error typically occurs when there's an issue with JWT token verification in AWS Cognito integration.

## Root Causes

1. **Missing `kid` (Key ID) in JWT header** - The JWT token doesn't contain the required `kid` claim
2. **Wrong token type** - Using Access token where ID token is expected or vice versa
3. **Incorrect Cognito configuration** - Missing or wrong environment variables
4. **Token format issues** - Malformed or corrupted JWT token

## Solutions Implemented

### 1. ✅ Updated Authentication Logic

**File**: `Backend/controllers/companyAnalyticsController.js`

**Changes Made**:
- Replaced the complex dual-token verification with a simpler, more robust approach
- Added proper error handling and logging
- Made authentication consistent with other controllers in the codebase
- Added environment variable validation

**New Authentication Function**:
```javascript
async function verifyToken(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw Object.assign(new Error('Missing bearer token'), { status: 401 });

  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    
    if (!userPoolId || !clientId) {
      throw Object.assign(new Error('Cognito configuration missing'), { status: 500 });
    }

    const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
    const payload = await verifier.verify(token);
    
    return {
      username: payload['cognito:username'] || payload['username'] || payload['email'],
      email: payload.email,
      role: payload['custom:role']?.toLowerCase(),
      originalPayload: payload
    };
  } catch (error) {
    console.error('Token verification error:', error.message);
    throw Object.assign(new Error('Invalid or expired token'), { status: 401 });
  }
}
```

### 2. 🔧 Debugging Tools Created

**File**: `Backend/debug-jwt-auth.js`
- Run this script to analyze your JWT token structure
- Usage: `node debug-jwt-auth.js <your-jwt-token>`
- Helps identify token format issues and missing claims

**File**: `Backend/test-auth-endpoint.js`
- Simple test server for debugging authentication
- Run: `node test-auth-endpoint.js`
- Test endpoint: `GET http://localhost:4001/test-auth`

## How to Debug Your Issue

### Step 1: Check Environment Variables
Ensure your `.env` file contains:
```env
COGNITO_USER_POOL_ID=your-user-pool-id
COGNITO_CLIENT_ID=your-client-id
```

### Step 2: Test Your Token
1. Get your JWT token from the frontend (check localStorage or network tab)
2. Run the debug script:
   ```bash
   cd Backend
   node debug-jwt-auth.js "your-jwt-token-here"
   ```

### Step 3: Check Token Type
The API expects an **ID token** by default. If you're using an **Access token**, you'll need to modify the verification logic.

### Step 4: Verify Token Structure
A valid JWT should have:
- Header with `kid` claim
- Payload with `token_use: "id"` (for ID tokens)
- Valid signature

## Common Solutions

### Solution 1: Use ID Token Instead of Access Token
If you're currently using an Access token, switch to ID token:
```javascript
// In your frontend authentication
const idToken = result.getIdToken().getJwtToken(); // Use this
// Instead of:
// const accessToken = result.getAccessToken().getJwtToken();
```

### Solution 2: Check Token Expiration
Ensure your token is not expired:
```javascript
const payload = JSON.parse(atob(token.split('.')[1]));
const expirationTime = payload.exp * 1000;
const isExpired = Date.now() > expirationTime;
```

### Solution 3: Verify Cognito Configuration
Make sure your Cognito User Pool and Client are correctly configured:
- User Pool ID should match the issuer in your token
- Client ID should match the audience in your token

## Testing the Fix

### 1. Test the Analytics API
```bash
curl -X GET "http://localhost:4000/api/companies/analytics/dashboard" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

### 2. Test with Debug Tools
```bash
# Start test server
node test-auth-endpoint.js

# In another terminal, test your token
curl -X GET "http://localhost:4001/test-auth" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Expected Response

**Success Response**:
```json
{
  "ok": true,
  "data": {
    "totals": {
      "totalJDs": 45,
      "totalApplicants": 850
    },
    "graphs": {
      "jdVsMonths": [...],
      "jdByHR": [...],
      "applicationsByDepartment": [...]
    }
  }
}
```

**Error Response**:
```json
{
  "ok": false,
  "error": "Invalid or expired token",
  "message": "Invalid or expired token"
}
```

## Next Steps

1. **Verify your token type** - Make sure you're using ID tokens
2. **Check environment variables** - Ensure Cognito configuration is correct
3. **Test with debug tools** - Use the provided debugging scripts
4. **Update frontend** - If needed, modify how tokens are obtained and sent

## Cleanup

After debugging, you can remove the debug files:
```bash
rm Backend/debug-jwt-auth.js
rm Backend/test-auth-endpoint.js
```

## Support

If you continue to have issues:
1. Check the console logs for detailed error messages
2. Verify your Cognito User Pool configuration
3. Ensure your token is being sent correctly from the frontend
4. Test with a fresh token from a new login session
