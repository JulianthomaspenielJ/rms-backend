console.log('Testing AWS module...');

// Try to require the new AWS module
const path = require('path');
const awsPath = path.join(__dirname, 'config', 'AWS-new.js');

console.log(`Attempting to require: ${awsPath}`);
try {
  const aws = require(awsPath);
  console.log('✅ Successfully required AWS module');
  console.log('Exported keys:', Object.keys(aws));
} catch (error) {
  console.error('❌ Failed to require AWS module:', error);
  console.error('Error details:', {
    code: error.code,
    message: error.message,
    stack: error.stack
  });
}
