// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
//test for git
const dynamodb = new AWS.DynamoDB();
const app = express();

app.use(cors({
  origin: "http://localhost:5173", // your frontend URL (Vite default)
  credentials: true
}));
app.use(express.json());

// Verify DynamoDB tables exist
// const verifyTables = async () => {
//   const tables = ['Tickets', 'TicketMessages'];
  
//   for (const table of tables) {
//     try {
//       await dynamodb.describeTable({ TableName: table }).promise();
//       console.log(`✅ Table ${table} exists`);
//     } catch (err) {
//       if (err.code === 'ResourceNotFoundException') {
//         console.error(`❌ Table ${table} does not exist. Please create it in your AWS DynamoDB console.`);
//       } else {
//         console.error(`Error checking table ${table}:`, err.message);
//       }
//       // Don't exit in development to allow for other routes to work
//       if (process.env.NODE_ENV === 'production') process.exit(1);
//     }
//   }
// };

// // Run table verification
// verifyTables();
// app.use(cors({ origin: true, credentials: true }));
// app.use(express.json());

// app.get('/', (_, res) => res.json({ ok: true, service: 'RMS API' }));

// routes
const authRoutes = require('./routes/authRoute');
const subAdminRoutes = require('./routes/subAdminRoute');
const hrRoutes = require('./routes/hrRoute');
const superAdminRoutes = require('./routes/superAdminRoute');
const feedbackRoutes = require('./routes/feedbackRoute');
const supportRoutes = require('./routes/supportRoute');
const superadminDashboardRoutes = require('./routes/superadminDashboardRoute');
const companyRoutes = require('./routes/companyRoute');
const ticketRoutes = require("./routes/ticketRoutes");
const messageRoutes = require("./routes/messageRoute");
const uploadRoutes = require('./routes/Hr/uploadRoutes');




app.use('/api/companies', companyRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/subadmin', subAdminRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/superadmin/dashboard', superadminDashboardRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/messages", messageRoutes);
app.use('/api/jd', uploadRoutes);






const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`RMS API running on :${port}`));
