// models/dynamoClient.js
const AWS = require("aws-sdk");
require("dotenv").config();

// Configure AWS DynamoDB
AWS.config.update({
  region: process.env.AWS_REGION || "ap-south-1", // use your AWS region
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,    // from .env
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // from .env
});

const dynamoClient = new AWS.DynamoDB.DocumentClient();

module.exports = dynamoClient;
