// Test script to verify candidate temporary password flow
const fetch = require('node-fetch');
require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testCandidateTempPasswordFlow() {
  console.log('🧪 Testing Candidate Temporary Password Flow');
  console.log('==========================================');

  try {
    // Test 1: Login with temporary password (should redirect to change password)
    console.log('\n1. Testing login with temporary password...');
    
    const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: 'test-candidate@example.com', // Replace with actual test candidate email
        password: 'TempPassword123!' // Replace with actual temporary password
      })
    });

    const loginData = await loginResponse.json();
    console.log('Login Response Status:', loginResponse.status);
    console.log('Login Response:', JSON.stringify(loginData, null, 2));

    if (loginData.requires_password_change) {
      console.log('✅ SUCCESS: Temporary password detected, should redirect to change password');
      
      // Test 2: Change password
      console.log('\n2. Testing password change...');
      
      const changePasswordResponse = await fetch(`${BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_address: loginData.user_details.email,
          old_password: loginData.user_details.temp_password,
          new_password: 'NewPassword123!',
          confirm_new_password: 'NewPassword123!'
        })
      });

      const changePasswordData = await changePasswordResponse.json();
      console.log('Change Password Response Status:', changePasswordResponse.status);
      console.log('Change Password Response:', JSON.stringify(changePasswordData, null, 2));

      if (changePasswordResponse.ok) {
        console.log('✅ SUCCESS: Password changed successfully');
        
        // Test 3: Login with new password
        console.log('\n3. Testing login with new password...');
        
        const newLoginResponse = await fetch(`${BASE_URL}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email_address: loginData.user_details.email,
            password: 'NewPassword123!'
          })
        });

        const newLoginData = await newLoginResponse.json();
        console.log('New Login Response Status:', newLoginResponse.status);
        console.log('New Login Response:', JSON.stringify(newLoginData, null, 2));

        if (newLoginResponse.ok && newLoginData.token) {
          console.log('✅ SUCCESS: Login with new password successful');
          console.log('🎉 Complete flow test PASSED!');
        } else {
          console.log('❌ FAILED: Login with new password failed');
        }
      } else {
        console.log('❌ FAILED: Password change failed');
      }
    } else {
      console.log('❌ FAILED: Temporary password not detected');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Instructions for manual testing
console.log('📋 Manual Testing Instructions:');
console.log('1. Create a candidate user with temporary password in Cognito');
console.log('2. Update the email_address and password in this script');
console.log('3. Run: node test-candidate-temp-password.js');
console.log('4. Check the console output for test results');
console.log('');

// Uncomment the line below to run the test
// testCandidateTempPasswordFlow();

module.exports = { testCandidateTempPasswordFlow };
