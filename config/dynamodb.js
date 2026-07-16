const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const docClient = DynamoDBDocumentClient.from(client);

const TABLES = {
  SHOPS: process.env.DYNAMODB_SHOPS_TABLE || 'see-before-buy-shops',
  USAGE_LOGS: process.env.DYNAMODB_USAGE_LOGS_TABLE || 'see-before-buy-usage-logs',
};

module.exports = { docClient, TABLES };
