// controllers/ticketController.js
const { v4: uuidv4 } = require("uuid");
const dynamoClient = require("../models/dynamoClient");

const TICKETS_TABLE = process.env.TICKETS_TABLE || "Tickets";
const MESSAGES_TABLE = process.env.TICKET_MESSAGES_TABLE || "TicketMessages";

// Create a new ticket
exports.createTicket = async (req, res) => {
  try {
    const { subject, description, priority, raised_by, role } = req.body;

    if (!subject || !description || !priority || !raised_by || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const ticket = {
      ticket_id: uuidv4(),
      subject,
      description,
      priority,
      status: "open",
      raised_by,
      role,
      assigned_to: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    console.log("Attempting to create ticket:", JSON.stringify(ticket, null, 2));
    
    const params = {
      TableName: TICKETS_TABLE,
      Item: ticket,
      ReturnValues: 'NONE',
      ReturnConsumedCapacity: 'TOTAL'
    };
    
    console.log("DynamoDB Params:", JSON.stringify(params, null, 2));
    
    const result = await dynamoClient.put(params).promise();
    console.log("DynamoDB Response:", JSON.stringify(result, null, 2));

    res.status(201).json(ticket);
  } catch (err) {
    console.error("Error creating ticket:", {
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      time: new Date().toISOString(),
      stack: err.stack
    });
    res.status(500).json({ 
      error: "Could not create ticket",
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Get tickets (all, or filter by user/assigned_to)
exports.getTickets = async (req, res) => {
  try {
    const { raised_by, assigned_to } = req.query;

    let params = {
      TableName: TICKETS_TABLE,
    };

    const data = await dynamoClient.scan(params).promise();
    let tickets = data.Items;

    if (raised_by) {
      tickets = tickets.filter((t) => t.raised_by === raised_by);
    }
    if (assigned_to) {
      tickets = tickets.filter((t) => t.assigned_to === assigned_to);
    }

    res.json(tickets);
  } catch (err) {
    console.error("Error fetching tickets:", err);
    res.status(500).json({ error: "Could not fetch tickets" });
  }
};

// Get single ticket by ID
exports.getTicketById = async (req, res) => {
  try {
    const { id } = req.params;

    const data = await dynamoClient
      .get({
        TableName: TICKETS_TABLE,
        Key: { ticket_id: id },
      })
      .promise();

    if (!data.Item) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    res.json(data.Item);
  } catch (err) {
    console.error("Error fetching ticket:", err);
    res.status(500).json({ error: "Could not fetch ticket" });
  }
};

// Assign a ticket to Sub Admin
exports.assignTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_to } = req.body;

    await dynamoClient
      .update({
        TableName: TICKETS_TABLE,
        Key: { ticket_id: id },
        UpdateExpression: "set assigned_to = :assigned, updated_at = :updated",
        ExpressionAttributeValues: {
          ":assigned": assigned_to,
          ":updated": new Date().toISOString(),
        },
        ReturnValues: "ALL_NEW",
      })
      .promise();

    res.json({ message: "Ticket assigned successfully" });
  } catch (err) {
    console.error("Error assigning ticket:", err);
    res.status(500).json({ error: "Could not assign ticket" });
  }
};

// Update ticket status
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await dynamoClient
      .update({
        TableName: TICKETS_TABLE,
        Key: { ticket_id: id },
        UpdateExpression: "set status = :status, updated_at = :updated",
        ExpressionAttributeValues: {
          ":status": status,
          ":updated": new Date().toISOString(),
        },
        ReturnValues: "ALL_NEW",
      })
      .promise();

    res.json({ message: "Status updated successfully" });
  } catch (err) {
    console.error("Error updating status:", err);
    res.status(500).json({ error: "Could not update status" });
  }
};

// Add message to ticket
exports.addMessage = async (req, res) => {
  try {
    const { ticket_id, sender, message } = req.body;

    if (!ticket_id || !sender || !message) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const msg = {
      message_id: uuidv4(),
      ticket_id,
      sender,
      message,
      time: new Date().toISOString(),
    };

    await dynamoClient
      .put({
        TableName: MESSAGES_TABLE,
        Item: msg,
      })
      .promise();

    res.status(201).json(msg);
  } catch (err) {
    console.error("Error adding message:", err);
    res.status(500).json({ error: "Could not add message" });
  }
};

// Get messages for a ticket
exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;

    const params = {
      TableName: MESSAGES_TABLE,
      FilterExpression: "ticket_id = :ticket_id",
      ExpressionAttributeValues: { ":ticket_id": id },
    };

    const data = await dynamoClient.scan(params).promise();
    res.json(data.Items);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: "Could not fetch messages" });
  }
};
