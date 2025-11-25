// Lambda function to process incoming emails from SES
// This will be triggered when emails are received at your support email address

const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamodb = new AWS.DynamoDB.DocumentClient();
const ses = new AWS.SES();

// Utility function to generate ticket number
function generateTicketNumber() {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substr(2, 5).toUpperCase();
  return `TKT-${timestamp.slice(-6)}-${random}`;
}

// Extract email content from SES event
function parseEmailContent(sesEvent) {
  try {
    const message = sesEvent.Records[0].ses.mail;
    const receipt = sesEvent.Records[0].ses.receipt;
    
    // Extract email details
    const from = message.commonHeaders.from;
    const subject = message.commonHeaders.subject || 'No Subject';
    const messageId = message.messageId;
    
    // Parse sender information
    const senderMatch = from.match(/"?([^"<]+)"?\s*<?([^>]*)>?/);
    const senderName = senderMatch ? senderMatch[1].trim() : from;
    const senderEmail = senderMatch ? senderMatch[2].trim() : from;
    
    // Extract email body (you might need to adjust based on your email format)
    let body = '';
    if (message.content) {
      // Try to get text content first, fallback to HTML
      body = message.content.text || message.content.html || '';
    }
    
    return {
      senderEmail,
      senderName,
      subject,
      body,
      messageId,
      timestamp: message.timestamp
    };
  } catch (error) {
    console.error('Error parsing email content:', error);
    throw error;
  }
}

// Determine user role from email domain or other criteria
function determineUserRole(senderEmail) {
  // You can implement logic to determine user role based on:
  // - Email domain (e.g., @company.com for company_admin)
  // - Email patterns
  // - Database lookup
  // - Default to 'general' if unknown
  
  const domain = senderEmail.split('@')[1]?.toLowerCase();
  
  if (domain === 'company.com' || domain === 'yourcompany.com') {
    return 'company_admin';
  } else if (domain === 'hr.company.com') {
    return 'hr';
  } else {
    return 'candidate'; // Default assumption
  }
}

// Create support ticket from email
async function createTicketFromEmail(emailData) {
  const nowIso = new Date().toISOString();
  const ticketId = uuidv4();
  const ticketNumber = generateTicketNumber();
  
  // Determine user role
  const userRole = determineUserRole(emailData.senderEmail);
  
  // Create ticket
  const ticketItem = {
    id: ticketId,
    ticket_number: ticketNumber,
    subject: emailData.subject,
    body: emailData.body,
    sender_email: emailData.senderEmail,
    sender_name: emailData.senderName,
    sender_role: userRole,
    priority: 'medium', // Default priority
    process_status: 'open',
    assigned_to: null,
    created_at: nowIso,
    created_by: emailData.senderEmail, // Use email as created_by for external emails
    updated_at: nowIso,
    updated_by: emailData.senderEmail,
    status: '1',
    category: 'email_support',
    attachments: [], // Handle attachments separately if needed
    tags: ['email', 'auto_created'],
    source_message_id: emailData.messageId,
    source_timestamp: emailData.timestamp
  };
  
  // Save ticket to DynamoDB
  const putTicketParams = {
    TableName: process.env.DDB_SUPPORT_TABLE || 'tb_support_tickets',
    Item: ticketItem
  };
  
  await dynamodb.put(putTicketParams).promise();
  
  // Create initial message for the ticket
  const messageItem = {
    id: uuidv4(),
    ticket_id: ticketId,
    message_type: 'incoming_email',
    subject: emailData.subject,
    body: emailData.body,
    sender_email: emailData.senderEmail,
    sender_name: emailData.senderName,
    sender_role: userRole,
    sender_id: null, // No internal user ID for external emails
    attachments: [],
    created_at: nowIso,
    created_by: emailData.senderEmail,
    updated_at: nowIso,
    updated_by: emailData.senderEmail,
    status: '1',
    is_internal: false,
    parent_message_id: null,
    source_message_id: emailData.messageId
  };
  
  const putMessageParams = {
    TableName: process.env.DDB_SUPPORT_MESSAGES_TABLE || 'tb_support_messages',
    Item: messageItem
  };
  
  await dynamodb.put(putMessageParams).promise();
  
  console.log(`Created support ticket ${ticketNumber} from email: ${emailData.messageId}`);
  
  return {
    ticketId,
    ticketNumber,
    senderEmail: emailData.senderEmail,
    subject: emailData.subject
  };
}

// Send auto-reply to sender
async function sendAutoReply(senderEmail, ticketNumber, subject) {
  try {
    const autoReplyParams = {
      Source: process.env.SUPPORT_EMAIL || 'support@yourcompany.com',
      Destination: {
        ToAddresses: [senderEmail]
      },
      Message: {
        Subject: {
          Data: `Re: ${subject} - Ticket #${ticketNumber}`
        },
        Body: {
          Text: {
            Data: `Thank you for contacting our support team.

Your support ticket has been created successfully.

Ticket Number: ${ticketNumber}
Subject: ${subject}

Our support team will review your request and respond within 24-48 hours.

If you have any urgent concerns, please call our support hotline.

Best regards,
Support Team`
          }
        }
      }
    };
    
    await ses.sendEmail(autoReplyParams).promise();
    console.log(`Auto-reply sent to ${senderEmail} for ticket ${ticketNumber}`);
    
  } catch (error) {
    console.error('Error sending auto-reply:', error);
    // Don't fail the entire process if auto-reply fails
  }
}

// Main Lambda handler
exports.handler = async (event) => {
  try {
    console.log('Processing SES event:', JSON.stringify(event, null, 2));
    
    // Parse email content from SES event
    const emailData = parseEmailContent(event);
    
    // Create support ticket
    const ticket = await createTicketFromEmail(emailData);
    
    // Send auto-reply to sender
    await sendAutoReply(ticket.senderEmail, ticket.ticketNumber, ticket.subject);
    
    // Return success
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Email processed successfully',
        ticketNumber: ticket.ticketNumber,
        ticketId: ticket.ticketId
      })
    };
    
  } catch (error) {
    console.error('Error processing email:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error processing email',
        error: error.message
      })
    };
  }
};
