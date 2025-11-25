const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { Cognito, Dynamo } = require('../config/AWS');
const supportTicketModel = require('../models/supportTicketModel');
const supportMessageModel = require('../models/supportMessageModel');
const { v4: uuidv4 } = require('uuid');

// Utility function to generate ticket number
function generateTicketNumber() {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substr(2, 5).toUpperCase();
  return `TKT-${timestamp.slice(-6)}-${random}`;
}

// Verify user role for support operations
async function verifyUserRole(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw Object.assign(new Error('Missing bearer token'), { status: 401 });

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) throw Object.assign(new Error('Cognito env not configured'), { status: 500 });

  let payload;
  try {
    const idVerifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
    payload = await idVerifier.verify(token);
  } catch (_) {
    try {
      const accessVerifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: 'access' });
      payload = await accessVerifier.verify(token);
    } catch (e2) {
      try {
        const jwt = require('jsonwebtoken');
        payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
        payload.__source = 'app';
      } catch (e3) {
        throw Object.assign(new Error('Invalid or expired token'), { status: 401 });
      }
    }
  }

  const username = payload['cognito:username'] || payload['username'] || payload['email'];
  if (!username) throw Object.assign(new Error('Unable to resolve requester identity'), { status: 401 });

  const adminUser = await Cognito.adminGetUser({ UserPoolId: userPoolId, Username: username }).promise();
  const attrs = adminUser.UserAttributes || [];
  const roleAttr = attrs.find(a => a.Name === 'custom:role');
  const role = String(roleAttr?.Value || '').toLowerCase();
  
  // Allow all user roles for support
  const allowedRoles = ['candidate', 'hr', 'company_admin', 'support_agent', 'super_admin', 'superadmin'];
  if (!allowedRoles.includes(role)) {
    throw Object.assign(new Error('Unauthorized role for support operations'), { status: 403 });
  }

  return {
    username,
    userId: username,
    email: payload.email || username,
    role: role
  };
}

// Verify support agent or admin role
async function verifySupportRole(req) {
  const user = await verifyUserRole(req);
  const supportRoles = ['support_agent', 'super_admin', 'superadmin'];
  
  if (!supportRoles.includes(user.role)) {
    throw Object.assign(new Error('Only support agents and admins can perform this operation'), { status: 403 });
  }
  
  return user;
}

// POST /api/support/create-ticket - Create support ticket manually
async function createSupportTicket(req, res) {
  try {
    const user = await verifyUserRole(req);
    
    const { 
      subject, 
      body, 
      priority, 
      category, 
      tags 
    } = req.body;
    
    // Validate required fields
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Subject is required and must be a non-empty string' });
    }
    
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Body is required and must be a non-empty string' });
    }
    
    // Validate priority
    const allowedPriorities = ['low', 'medium', 'high', 'urgent'];
    if (priority && !allowedPriorities.includes(priority)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid priority. Allowed values are: low, medium, high, urgent' 
      });
    }
    
    const nowIso = new Date().toISOString();
    const ticketId = uuidv4();
    const ticketNumber = generateTicketNumber();
    
    // Build ticket item
    const ticketItem = supportTicketModel.buildItem({
      id: ticketId,
      ticket_number: ticketNumber,
      subject: subject.trim(),
      body: body.trim(),
      sender_email: user.email,
      sender_name: user.username,
      sender_role: user.role,
      priority: priority || 'medium',
      process_status: 'open',
      assigned_to: null,
      created_at: nowIso,
      created_by: user.userId,
      updated_at: nowIso,
      updated_by: user.userId,
      status: '1',
      category: category || 'general',
      attachments: [],
      tags: tags || []
    });
    
    // Save ticket to DynamoDB
    const putTicketParams = {
      TableName: supportTicketModel.tableName,
      Item: ticketItem
    };
    
    await Dynamo.put(putTicketParams).promise();
    
    // Create initial message for the ticket
    const messageItem = supportMessageModel.buildItem({
      id: uuidv4(),
      ticket_id: ticketId,
      message_type: 'incoming_email',
      subject: subject.trim(),
      body: body.trim(),
      sender_email: user.email,
      sender_name: user.username,
      sender_role: user.role,
      sender_id: user.userId,
      attachments: [],
      created_at: nowIso,
      created_by: user.userId,
      updated_at: nowIso,
      updated_by: user.userId,
      status: '1',
      is_internal: false,
      parent_message_id: null
    });
    
    const putMessageParams = {
      TableName: supportMessageModel.tableName,
      Item: messageItem
    };
    
    await Dynamo.put(putMessageParams).promise();
    
    // Format response
    const formattedTicket = {
      id: ticketItem.id,
      ticketNumber: ticketItem.ticket_number,
      subject: ticketItem.subject,
      body: ticketItem.body,
      senderEmail: ticketItem.sender_email,
      senderName: ticketItem.sender_name,
      senderRole: ticketItem.sender_role,
      priority: ticketItem.priority,
      processStatus: ticketItem.process_status,
      assignedTo: ticketItem.assigned_to,
      category: ticketItem.category,
      tags: ticketItem.tags,
      createdAt: ticketItem.created_at,
      createdBy: ticketItem.created_by
    };
    
    return res.status(201).json({
      ok: true,
      message: 'Support ticket created successfully',
      data: formattedTicket
    });
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

// GET /api/support/tickets - Get tickets (filtered by user role)
async function getSupportTickets(req, res) {
  try {
    const user = await verifyUserRole(req);
    const { 
      status, 
      priority, 
      assigned_to, 
      page = 1, 
      limit = 20 
    } = req.query;
    
    // Build scan parameters
    let params = { 
      TableName: supportTicketModel.tableName,
      Limit: parseInt(limit)
    };
    
    let filterExpressions = [];
    let expressionAttributeNames = {};
    let expressionAttributeValues = {};
    
    // Filter by status if provided
    if (status) {
      filterExpressions.push('#ps = :status');
      expressionAttributeNames['#ps'] = 'process_status';
      expressionAttributeValues[':status'] = status;
    }
    
    // Filter by priority if provided
    if (priority) {
      filterExpressions.push('#p = :priority');
      expressionAttributeNames['#p'] = 'priority';
      expressionAttributeValues[':priority'] = priority;
    }
    
    // Filter by assigned_to if provided
    if (assigned_to) {
      filterExpressions.push('#at = :assigned_to');
      expressionAttributeNames['#at'] = 'assigned_to';
      expressionAttributeValues[':assigned_to'] = assigned_to;
    }
    
    // Regular users can only see their own tickets
    if (!['support_agent', 'super_admin', 'superadmin'].includes(user.role)) {
      filterExpressions.push('#se = :sender_email');
      expressionAttributeNames['#se'] = 'sender_email';
      expressionAttributeValues[':sender_email'] = user.email;
    }
    
    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
      params.ExpressionAttributeValues = expressionAttributeValues;
    }
    
    const out = await Dynamo.scan(params).promise();
    const items = out.Items || [];
    
    // Format response
    const formattedTickets = items.map(ticket => ({
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      body: ticket.body,
      senderEmail: ticket.sender_email,
      senderName: ticket.sender_name,
      senderRole: ticket.sender_role,
      priority: ticket.priority,
      processStatus: ticket.process_status,
      assignedTo: ticket.assigned_to,
      category: ticket.category,
      tags: ticket.tags,
      createdAt: ticket.created_at,
      createdBy: ticket.created_by,
      updatedAt: ticket.updated_at,
      updatedBy: ticket.updated_by
    }));
    
    return res.json({
      ok: true,
      count: items.length,
      data: formattedTickets,
      message: 'Support tickets retrieved successfully'
    });
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

// GET /api/support/ticket/:id - Get specific ticket with messages
async function getSupportTicket(req, res) {
  try {
    const user = await verifyUserRole(req);
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ ok: false, error: 'Ticket ID is required' });
    }
    
    // Get ticket details
    const ticketParams = {
      TableName: supportTicketModel.tableName,
      Key: { id: id }
    };
    
    const ticketResult = await Dynamo.get(ticketParams).promise();
    if (!ticketResult.Item) {
      return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    
    const ticket = ticketResult.Item;
    
    // Check if user has access to this ticket
    if (!['support_agent', 'super_admin', 'superadmin'].includes(user.role) && 
        ticket.sender_email !== user.email) {
      return res.status(403).json({ ok: false, error: 'Access denied to this ticket' });
    }
    
    // Get all messages for this ticket
    const messageParams = {
      TableName: supportMessageModel.tableName,
      FilterExpression: '#tid = :ticket_id',
      ExpressionAttributeNames: {
        '#tid': 'ticket_id'
      },
      ExpressionAttributeValues: {
        ':ticket_id': id
      }
    };
    
    const messagesResult = await Dynamo.scan(messageParams).promise();
    const messages = messagesResult.Items || [];
    
    // Format response
    const formattedTicket = {
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      body: ticket.body,
      senderEmail: ticket.sender_email,
      senderName: ticket.sender_name,
      senderRole: ticket.sender_role,
      priority: ticket.priority,
      processStatus: ticket.process_status,
      assignedTo: ticket.assigned_to,
      category: ticket.category,
      tags: ticket.tags,
      createdAt: ticket.created_at,
      createdBy: ticket.created_by,
      updatedAt: ticket.updated_at,
      updatedBy: ticket.updated_by,
      messages: messages.map(msg => ({
        id: msg.id,
        messageType: msg.message_type,
        subject: msg.subject,
        body: msg.body,
        senderEmail: msg.sender_email,
        senderName: msg.sender_name,
        senderRole: msg.sender_role,
        attachments: msg.attachments,
        createdAt: msg.created_at,
        isInternal: msg.is_internal,
        parentMessageId: msg.parent_message_id
      }))
    };
    
    return res.json({
      ok: true,
      data: formattedTicket,
      message: 'Support ticket retrieved successfully'
    });
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

// POST /api/support/ticket/:id/reply - Add reply to ticket
async function addTicketReply(req, res) {
  try {
    const user = await verifyUserRole(req);
    const { id } = req.params;
    const { body, subject, isInternal = false, parentMessageId = null } = req.body;
    
    if (!id) {
      return res.status(400).json({ ok: false, error: 'Ticket ID is required' });
    }
    
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Body is required and must be a non-empty string' });
    }
    
    // Check if ticket exists
    const ticketParams = {
      TableName: supportTicketModel.tableName,
      Key: { id: id }
    };
    
    const ticketResult = await Dynamo.get(ticketParams).promise();
    if (!ticketResult.Item) {
      return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    
    const ticket = ticketResult.Item;
    
    // Check if user has access to this ticket
    if (!['support_agent', 'super_admin', 'superadmin'].includes(user.role) && 
        ticket.sender_email !== user.email) {
      return res.status(403).json({ ok: false, error: 'Access denied to this ticket' });
    }
    
    const nowIso = new Date().toISOString();
    
    // Create message
    const messageItem = supportMessageModel.buildItem({
      id: uuidv4(),
      ticket_id: id,
      message_type: isInternal ? 'internal_note' : 'support_reply',
      subject: subject || `Re: ${ticket.subject}`,
      body: body.trim(),
      sender_email: user.email,
      sender_name: user.username,
      sender_role: user.role,
      sender_id: user.userId,
      attachments: [],
      created_at: nowIso,
      created_by: user.userId,
      updated_at: nowIso,
      updated_by: user.userId,
      status: '1',
      is_internal: isInternal,
      parent_message_id: parentMessageId
    });
    
    const putMessageParams = {
      TableName: supportMessageModel.tableName,
      Item: messageItem
    };
    
    await Dynamo.put(putMessageParams).promise();
    
    // Update ticket's updated_at and updated_by
    const updateTicketParams = {
      TableName: supportTicketModel.tableName,
      Key: { id: id },
      UpdateExpression: 'SET #ua = :ua, #ub = :ub',
      ExpressionAttributeNames: {
        '#ua': 'updated_at',
        '#ub': 'updated_by'
      },
      ExpressionAttributeValues: {
        ':ua': nowIso,
        ':ub': user.userId
      },
      ReturnValues: 'ALL_NEW'
    };
    
    await Dynamo.update(updateTicketParams).promise();
    
    // Format response
    const formattedMessage = {
      id: messageItem.id,
      messageType: messageItem.message_type,
      subject: messageItem.subject,
      body: messageItem.body,
      senderEmail: messageItem.sender_email,
      senderName: messageItem.sender_name,
      senderRole: messageItem.sender_role,
      attachments: messageItem.attachments,
      createdAt: messageItem.created_at,
      isInternal: messageItem.is_internal,
      parentMessageId: messageItem.parent_message_id
    };
    
    return res.status(201).json({
      ok: true,
      message: 'Reply added successfully',
      data: formattedMessage
    });
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

// PATCH /api/support/ticket/:id/update - Update ticket (support agents only)
async function updateSupportTicket(req, res) {
  try {
    const user = await verifySupportRole(req);
    const { id } = req.params;
    const { 
      priority, 
      process_status, 
      assigned_to, 
      category, 
      tags 
    } = req.body;
    
    if (!id) {
      return res.status(400).json({ ok: false, error: 'Ticket ID is required' });
    }
    
    // Validate process_status
    const allowedStatuses = ['open', 'in_progress', 'escalated', 'closed'];
    if (process_status && !allowedStatuses.includes(process_status)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid process_status. Allowed values are: open, in_progress, escalated, closed' 
      });
    }
    
    // Validate priority
    const allowedPriorities = ['low', 'medium', 'high', 'urgent'];
    if (priority && !allowedPriorities.includes(priority)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid priority. Allowed values are: low, medium, high, urgent' 
      });
    }
    
    // Check if ticket exists
    const ticketParams = {
      TableName: supportTicketModel.tableName,
      Key: { id: id }
    };
    
    const ticketResult = await Dynamo.get(ticketParams).promise();
    if (!ticketResult.Item) {
      return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    
    const nowIso = new Date().toISOString();
    
    // Build update expression
    let updateExpression = 'SET #ua = :ua, #ub = :ub';
    let expressionAttributeNames = {
      '#ua': 'updated_at',
      '#ub': 'updated_by'
    };
    let expressionAttributeValues = {
      ':ua': nowIso,
      ':ub': user.userId
    };
    
    if (priority) {
      updateExpression += ', #p = :priority';
      expressionAttributeNames['#p'] = 'priority';
      expressionAttributeValues[':priority'] = priority;
    }
    
    if (process_status) {
      updateExpression += ', #ps = :process_status';
      expressionAttributeNames['#ps'] = 'process_status';
      expressionAttributeValues[':process_status'] = process_status;
    }
    
    if (assigned_to !== undefined) {
      updateExpression += ', #at = :assigned_to';
      expressionAttributeNames['#at'] = 'assigned_to';
      expressionAttributeValues[':assigned_to'] = assigned_to;
    }
    
    if (category) {
      updateExpression += ', #c = :category';
      expressionAttributeNames['#c'] = 'category';
      expressionAttributeValues[':category'] = category;
    }
    
    if (tags) {
      updateExpression += ', #t = :tags';
      expressionAttributeNames['#t'] = 'tags';
      expressionAttributeValues[':tags'] = tags;
    }
    
    const updateParams = {
      TableName: supportTicketModel.tableName,
      Key: { id: id },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };
    
    const result = await Dynamo.update(updateParams).promise();
    const updatedTicket = result.Attributes;
    
    // Format response
    const formattedTicket = {
      id: updatedTicket.id,
      ticketNumber: updatedTicket.ticket_number,
      subject: updatedTicket.subject,
      body: updatedTicket.body,
      senderEmail: updatedTicket.sender_email,
      senderName: updatedTicket.sender_name,
      senderRole: updatedTicket.sender_role,
      priority: updatedTicket.priority,
      processStatus: updatedTicket.process_status,
      assignedTo: updatedTicket.assigned_to,
      category: updatedTicket.category,
      tags: updatedTicket.tags,
      createdAt: updatedTicket.created_at,
      createdBy: updatedTicket.created_by,
      updatedAt: updatedTicket.updated_at,
      updatedBy: updatedTicket.updated_by
    };
    
    return res.json({
      ok: true,
      message: 'Ticket updated successfully',
      data: formattedTicket
    });
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

// GET /api/support/list - Get support list with analytics (super admin only)
async function supportList(req, res) {
  try {
    // Verify super admin access
    const user = await verifySupportRole(req);
    
    // Only super admins can access this endpoint
    if (!['super_admin', 'superadmin'].includes(user.role)) {
      return res.status(403).json({ 
        ok: false, 
        error: 'Only super admins can access support list' 
      });
    }
    
    // Get query parameters for filtering
    const { 
      status, 
      priority, 
      assigned_to, 
      category,
      page = 1, 
      limit = 50 
    } = req.query;
    
    // Build scan parameters
    let params = { 
      TableName: supportTicketModel.tableName,
      Limit: parseInt(limit)
    };
    
    let filterExpressions = [];
    let expressionAttributeNames = {};
    let expressionAttributeValues = {};
    
    // Filter by status if provided
    if (status) {
      filterExpressions.push('#ps = :status');
      expressionAttributeNames['#ps'] = 'process_status';
      expressionAttributeValues[':status'] = status;
    }
    
    // Filter by priority if provided
    if (priority) {
      filterExpressions.push('#p = :priority');
      expressionAttributeNames['#p'] = 'priority';
      expressionAttributeValues[':priority'] = priority;
    }
    
    // Filter by assigned_to if provided
    if (assigned_to) {
      filterExpressions.push('#at = :assigned_to');
      expressionAttributeNames['#at'] = 'assigned_to';
      expressionAttributeValues[':assigned_to'] = assigned_to;
    }
    
    // Filter by category if provided
    if (category) {
      filterExpressions.push('#c = :category');
      expressionAttributeNames['#c'] = 'category';
      expressionAttributeValues[':category'] = category;
    }
    
    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeNames = expressionAttributeNames;
      params.ExpressionAttributeValues = expressionAttributeValues;
    }
    
    // Get all tickets for analytics
    const out = await Dynamo.scan(params).promise();
    const items = out.Items || [];
    
    // Calculate analytics
    const totalSupport = items.length;
    
    // Count by process status
    const statusCounts = {
      open: items.filter(ticket => ticket.process_status === 'open').length,
      in_progress: items.filter(ticket => ticket.process_status === 'in_progress').length,
      escalated: items.filter(ticket => ticket.process_status === 'escalated').length,
      closed: items.filter(ticket => ticket.process_status === 'closed').length
    };
    
    // Count by priority
    const priorityCounts = {
      low: items.filter(ticket => ticket.priority === 'low').length,
      medium: items.filter(ticket => ticket.priority === 'medium').length,
      high: items.filter(ticket => ticket.priority === 'high').length,
      urgent: items.filter(ticket => ticket.priority === 'urgent').length
    };
    
    // Count by sender role
    const roleCounts = {
      candidate: items.filter(ticket => ticket.sender_role === 'candidate').length,
      hr: items.filter(ticket => ticket.sender_role === 'hr').length,
      company_admin: items.filter(ticket => ticket.sender_role === 'company_admin').length
    };
    
    // Count by category
    const categoryCounts = {};
    items.forEach(ticket => {
      const cat = ticket.category || 'general';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
    
    // Calculate resolved tickets (closed status)
    const resolvedCount = statusCounts.closed;
    
    // Format tickets for response
    const formattedTickets = items.map(ticket => ({
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      body: ticket.body,
      senderEmail: ticket.sender_email,
      senderName: ticket.sender_name,
      senderRole: ticket.sender_role,
      priority: ticket.priority,
      processStatus: ticket.process_status,
      assignedTo: ticket.assigned_to,
      category: ticket.category,
      tags: ticket.tags,
      createdAt: ticket.created_at,
      createdBy: ticket.created_by,
      updatedAt: ticket.updated_at,
      updatedBy: ticket.updated_by
    }));
    
    // Build analytics response
    const analytics = {
      totalSupport,
      statusBreakdown: {
        open: statusCounts.open,
        inProgress: statusCounts.in_progress,
        escalated: statusCounts.escalated,
        resolved: resolvedCount
      },
      priorityBreakdown: {
        low: priorityCounts.low,
        medium: priorityCounts.medium,
        high: priorityCounts.high,
        urgent: priorityCounts.urgent
      },
      supportByRole: {
        candidate: roleCounts.candidate,
        hr: roleCounts.hr,
        company_admin: roleCounts.company_admin
      },
      categoryBreakdown: categoryCounts,
      summary: {
        totalOpen: statusCounts.open + statusCounts.in_progress,
        totalEscalated: statusCounts.escalated,
        totalResolved: resolvedCount,
        resolutionRate: totalSupport > 0 ? ((resolvedCount / totalSupport) * 100).toFixed(2) : 0
      }
    };
    
    return res.json({
      ok: true,
      message: 'Support list retrieved successfully',
      count: totalSupport,
      analytics: analytics,
      data: formattedTickets
    });
    
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ 
      ok: false, 
      error: error.name || 'InternalError', 
      message: error.message 
    });
  }
}

module.exports = { 
  createSupportTicket, 
  getSupportTickets, 
  getSupportTicket, 
  addTicketReply, 
  updateSupportTicket,
  supportList
};
