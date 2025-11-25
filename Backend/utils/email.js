const nodemailer = require('nodemailer');
require('dotenv').config();

// Configure transporter from environment
// Expected .env keys:
// SMTP_HOST, SMTP_PORT, SMTP_SECURE (true/false), SMTP_USER, SMTP_PASS, SMTP_FROM
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false') === 'true',
  auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined
});

async function sendEmail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || 'no-reply@rms.local';
  return transporter.sendMail({ from, to, subject, text, html });
}

module.exports = { sendEmail };
