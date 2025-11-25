// routes/messageRoutes.js
const express = require("express");
const router = express.Router();

const messageController = require("../controllers/messageController");

// 💬 Message routes
router.post("/:ticket_id", messageController.addMessage);      // Add message to a ticket
router.get("/:ticket_id", messageController.getMessagesByTicket); // Get all messages for a ticket

module.exports = router;
