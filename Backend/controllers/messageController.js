// controllers/messageController.js
const { v4: uuidv4 } = require("uuid");
const dynamoClient = require("../models/dynamoClient");

const MESSAGES_TABLE = "TicketMessages";

// Add a message to a ticket
exports.addMessage = async (req, res) => {
  try {
    const { ticket_id } = req.params; // ticket ID from URL
    const { sender, message } = req.body;

    if (!ticket_id || !sender || !message) {
      return res.status(400).json({ error: "Missing required fields" });
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

// Get all messages for a ticket
exports.getMessagesByTicket = async (req, res) => {
  try {
    const { ticket_id } = req.params;

    const params = {
      TableName: MESSAGES_TABLE,
      FilterExpression: "ticket_id = :ticket_id",
      ExpressionAttributeValues: { ":ticket_id": ticket_id },
    };

    const data = await dynamoClient.scan(params).promise();
    res.json(data.Items);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: "Could not fetch messages" });
  }
};
