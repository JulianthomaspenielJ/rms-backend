// config/aws.js
const AWS = require('aws-sdk');
require('dotenv').config();

AWS.config.update({ region: process.env.AWS_REGION || 'ap-south-1' });

const Cognito = new AWS.CognitoIdentityServiceProvider();
const Dynamo = new AWS.DynamoDB.DocumentClient();

module.exports = { AWS, Cognito, Dynamo };
