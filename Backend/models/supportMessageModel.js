// models/supportMessageModel.js
module.exports = {
  tableName: process.env.DDB_SUPPORT_MESSAGES_TABLE || 'tb_support_messages',
  buildItem({ 
    id, 
    ticket_id, 
    message_type, // 'incoming_email', 'support_reply', 'internal_note'
    subject, 
    body, 
    sender_email, 
    sender_name, 
    sender_role, 
    sender_id, // user ID if from our system
    attachments, 
    created_at, 
    created_by, 
    updated_at, 
    updated_by, 
    status,
    is_internal, // true for internal notes
    parent_message_id // for threaded replies
  }) {
    return {
      id,
      ticket_id,
      message_type,
      subject: subject || '',
      body: body || '',
      sender_email,
      sender_name,
      sender_role,
      sender_id: sender_id || null,
      attachments: attachments || [],
      created_at,
      created_by,
      updated_at,
      updated_by,
      status: status ?? '1',
      is_internal: is_internal ?? false,
      parent_message_id: parent_message_id || null
    };
  }
};
