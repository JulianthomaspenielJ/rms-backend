const express = require('express');
const router = express.Router();

const { 
  createSupportTicket, 
  getSupportTickets, 
  getSupportTicket, 
  addTicketReply, 
  updateSupportTicket,
  supportList
} = require('../controllers/supportController');

// Support ticket routes

// POST /api/support/create-ticket - Create new support ticket
router.post('/create-ticket', createSupportTicket);

// GET /api/support/tickets - Get all tickets (filtered by user role)
router.get('/tickets', getSupportTickets);

// GET /api/support/ticket/:id - Get specific ticket with messages
router.get('/ticket/:id', getSupportTicket);

// POST /api/support/ticket/:id/reply - Add reply to ticket
router.post('/ticket/:id/reply', addTicketReply);

// PATCH /api/support/ticket/:id/update - Update ticket (support agents only)
router.patch('/ticket/:id/update', updateSupportTicket);

// GET /api/support/list - Get support list with analytics (super admin only)
router.get('/list', supportList);

module.exports = router;
