// routes/ticketRoutes.js
const express = require("express");
const router = express.Router();

const ticketController = require("../controllers/ticketController");
const messageController = require("../controllers/messageController");

// 🎟 Ticket routes
router.post("/", ticketController.createTicket);             // Create a ticket
router.get("/", ticketController.getTickets);                // Get tickets (all or filtered)
router.get("/:id", ticketController.getTicketById);          // Get single ticket
router.patch("/:id/assign", ticketController.assignTicket);  // Assign to sub admin
router.patch("/:id/status", ticketController.updateStatus);  // Update status

// 💬 Message routes (nested under tickets)
// router.post("/:ticket_id/messages", messageController.addMessage); 
// router.get("/:ticket_id/messages", messageController.getMessagesByTicket);

module.exports = router;
