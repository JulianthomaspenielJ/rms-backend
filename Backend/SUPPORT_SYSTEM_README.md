# Support Ticketing System - Complete Implementation Guide

## Overview
This is a comprehensive support ticketing system that handles both manual ticket creation and automatic email processing. It includes ticket management, communication tracking, and role-based access control.

## System Architecture

### 1. **Manual Ticket Creation**
- Users (candidate, hr, company_admin) can create tickets via API
- Support agents can manage and update tickets
- Full audit trail and communication history

### 2. **Email Integration**
- AWS SES receives emails at support email address
- Lambda function processes emails and creates tickets automatically
- Auto-reply confirmation sent to sender

### 3. **Database Structure**
- **tb_support_tickets**: Main ticket information
- **tb_support_messages**: All communications in ticket threads

## API Endpoints

### **Ticket Management**
- `POST /api/support/create-ticket` - Create new ticket
- `GET /api/support/tickets` - List tickets (filtered by user role)
- `GET /api/support/ticket/:id` - Get specific ticket with messages
- `POST /api/support/ticket/:id/reply` - Add reply to ticket
- `PATCH /api/support/ticket/:id/update` - Update ticket (support agents only)
- `GET /api/support/list` - Get support list with analytics (super admin only)

### **Access Control**
- **Regular Users**: Can create tickets and view their own tickets
- **Support Agents**: Can view all tickets, update status, assign tickets
- **Super Admins**: Full access to all operations

## Database Tables

### **tb_support_tickets**
```json
{
  "id": "uuid",
  "ticket_number": "TKT-123456-ABC12",
  "subject": "Technical Issue",
  "body": "Description of the problem",
  "sender_email": "user@example.com",
  "sender_name": "John Doe",
  "sender_role": "candidate",
  "priority": "medium",
  "process_status": "open",
  "assigned_to": "support_agent_id",
  "created_at": "2024-01-20T10:30:00.000Z",
  "created_by": "user_id",
  "updated_at": "2024-01-20T10:30:00.000Z",
  "updated_by": "user_id",
  "status": "1",
  "category": "technical",
  "attachments": [],
  "tags": ["urgent", "bug"]
}
```

### **tb_support_messages**
```json
{
  "id": "uuid",
  "ticket_id": "ticket_uuid",
  "message_type": "incoming_email|support_reply|internal_note",
  "subject": "Re: Technical Issue",
  "body": "Message content",
  "sender_email": "support@company.com",
  "sender_name": "Support Agent",
  "sender_role": "support_agent",
  "sender_id": "agent_user_id",
  "attachments": [],
  "created_at": "2024-01-20T10:30:00.000Z",
  "created_by": "agent_user_id",
  "updated_at": "2024-01-20T10:30:00.000Z",
  "updated_by": "agent_user_id",
  "status": "1",
  "is_internal": false,
  "parent_message_id": "parent_message_uuid"
}
```

## Setup Instructions

### 1. **Environment Variables**
Add these to your `.env` file:
```bash
# Support System
DDB_SUPPORT_TABLE=tb_support_tickets
DDB_SUPPORT_MESSAGES_TABLE=tb_support_messages
SUPPORT_EMAIL=support@yourcompany.com

# AWS Configuration
AWS_REGION=ap-south-1
COGNITO_USER_POOL_ID=your_user_pool_id
COGNITO_CLIENT_ID=your_client_id
```

### 2. **DynamoDB Tables**
Create these tables in AWS DynamoDB:

#### **tb_support_tickets**
- **Partition Key**: `id` (String)
- **Sort Key**: None
- **GSI**: `ticket_number-index` on `ticket_number`

#### **tb_support_messages**
- **Partition Key**: `id` (String)
- **Sort Key**: None
- **GSI**: `ticket_id-index` on `ticket_id`

### 3. **AWS SES Setup**
1. **Verify Domain**: Add your domain to SES
2. **Create Rule Set**: Set up email receiving rules
3. **Configure Lambda Trigger**: Point to the email processor Lambda

### 4. **Lambda Function Setup**
1. **Create Function**: Upload `emailProcessor.js`
2. **Set Environment Variables**:
   - `DDB_SUPPORT_TABLE`
   - `DDB_SUPPORT_MESSAGES_TABLE`
   - `SUPPORT_EMAIL`
3. **Set IAM Permissions**: DynamoDB write access, SES send access
4. **Configure Trigger**: SES email receiving rule

## Usage Examples

### **Create Support Ticket**
```bash
POST /api/support/create-ticket
Authorization: Bearer <token>

{
  "subject": "Login Issue",
  "body": "I cannot log into the system",
  "priority": "high",
  "category": "authentication",
  "tags": ["urgent", "login"]
}
```

### **Get User's Tickets**
```bash
GET /api/support/tickets
Authorization: Bearer <token>
```

### **Add Reply to Ticket**
```bash
POST /api/support/ticket/123/reply
Authorization: Bearer <token>

{
  "body": "We're investigating this issue",
  "subject": "Re: Login Issue",
  "isInternal": false
}
```

### **Update Ticket (Support Agents)**
```bash
PATCH /api/support/ticket/123/update
Authorization: Bearer <token>

{
  "priority": "urgent",
  "process_status": "in_progress",
  "assigned_to": "agent_user_id"
}
```

### **Get Support List with Analytics (Super Admin Only)**
```bash
GET /api/support/list
Authorization: Bearer <token>

# Optional query parameters for filtering:
# ?status=open&priority=high&category=technical&limit=100
```

**Response includes:**
- Total support count
- Status breakdown (open, in_progress, escalated, resolved)
- Priority breakdown (low, medium, high, urgent)
- Support by role (candidate, hr, company_admin)
- Category breakdown
- Summary metrics (resolution rate, etc.)
- Full ticket list

## Email Processing Flow

1. **Email Received**: User sends email to support@yourcompany.com
2. **SES Trigger**: AWS SES receives email and triggers Lambda
3. **Email Parsing**: Lambda extracts sender, subject, body
4. **Role Detection**: System determines user role from email domain
5. **Ticket Creation**: New ticket created in DynamoDB
6. **Message Recording**: Email content saved as first message
7. **Auto-Reply**: Confirmation email sent to sender
8. **Support Notification**: Support team can see new ticket

## Features

### **Ticket Management**
- ✅ Automatic ticket numbering (TKT-123456-ABC12)
- ✅ Priority levels (low, medium, high, urgent)
- ✅ Process status tracking (open, in_progress, escalated, closed)
- ✅ Assignment to support agents
- ✅ Category and tagging system

### **Communication Tracking**
- ✅ Thread-based message history
- ✅ Internal notes for support team
- ✅ Attachment support (structure ready)
- ✅ Full audit trail

### **Security & Access Control**
- ✅ Role-based permissions
- ✅ Users can only see their own tickets
- ✅ Support agents have full access
- ✅ JWT token authentication

### **Email Integration**
- ✅ Automatic ticket creation from emails
- ✅ Smart role detection
- ✅ Auto-reply confirmation
- ✅ Email threading support

## Customization Options

### **Priority Rules**
Modify `determineUserRole()` function to implement custom priority logic based on:
- Email content analysis
- Sender domain patterns
- Keyword detection
- Time-based rules

### **Auto-Reply Templates**
Customize auto-reply messages in `sendAutoReply()` function:
- Company branding
- SLA information
- Escalation procedures
- Multi-language support

### **Attachment Handling**
Extend the system to handle file attachments:
- S3 integration for file storage
- File type validation
- Size limits
- Virus scanning

## Monitoring & Analytics

### **CloudWatch Logs**
- Lambda execution logs
- Email processing metrics
- Error tracking

### **DynamoDB Metrics**
- Table performance
- Read/write capacity
- Error rates

### **SES Metrics**
- Email delivery rates
- Bounce rates
- Complaint rates

## Troubleshooting

### **Common Issues**
1. **Lambda Timeout**: Increase timeout for large emails
2. **DynamoDB Errors**: Check IAM permissions
3. **SES Bounces**: Verify sender email addresses
4. **Email Parsing**: Adjust parsing logic for different email formats

### **Debug Mode**
Enable detailed logging in Lambda:
```javascript
console.log('Email data:', JSON.stringify(emailData, null, 2));
console.log('Ticket created:', JSON.stringify(ticket, null, 2));
```

## Future Enhancements

1. **Slack Integration**: Notify support team on new tickets
2. **SLA Tracking**: Automatic escalation based on response time
3. **Knowledge Base**: Link tickets to solutions
4. **Customer Portal**: Web interface for ticket management
5. **Reporting**: Analytics and performance metrics
6. **Multi-language**: Internationalization support

## Support


