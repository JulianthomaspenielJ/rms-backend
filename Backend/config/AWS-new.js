// config/aws.js
const AWS = require('aws-sdk');
require('dotenv').config();

AWS.config.update({ 
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const Cognito = new AWS.CognitoIdentityServiceProvider();
const Dynamo = new AWS.DynamoDB.DocumentClient();

console.log('AWS module loaded successfully');
console.log('AWS Region:', AWS.config.region);

module.exports = { 
  AWS, 
  Cognito, 
  Dynamo 
};
