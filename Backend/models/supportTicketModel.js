// models/supportTicketModel.js
module.exports = {
  tableName: process.env.DDB_SUPPORT_TABLE || 'tb_support_tickets',
  buildItem({ 
    id, 
    ticket_number, 
    subject, 
    body, 
    sender_email, 
    sender_name, 
    sender_role, 
    priority, 
    process_status, 
    assigned_to, 
    created_at, 
    created_by, 
    updated_at, 
    updated_by, 
    status,
    category,
    attachments,
    tags
  }) {
    return {
      id,
      ticket_number,
      subject: subject || 'No Subject',
      body: body || '',
      sender_email,
      sender_name,
      sender_role,
      priority: priority ?? 'medium', // low, medium, high, urgent
      process_status: process_status ?? 'open', // open, in_progress, escalated, closed
      assigned_to: assigned_to || null,
      created_at,
      created_by,
      updated_at,
      updated_by,
      status: status ?? '1',
      category: category || 'general',
      attachments: attachments || [],
      tags: tags || []
    };
  }
};
