import type { Request, Response } from 'express';
import { SupportTicket } from '../../models/SupportTicket';

/**
 * GET /api/v1/admin/tickets
 * Fetch all support tickets
 */
export const getTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};

    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: { tickets } });
  } catch (error) {
    req.log.error(error, 'Error fetching support tickets');
    res.status(500).json({ success: false, message: 'Failed to fetch tickets' });
  }
};

/**
 * POST /api/v1/admin/tickets/:id/reply
 * Add a reply to a support ticket and optionally resolve it
 */
export const replyToTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { reply, resolve } = req.body;

    if (!reply) {
      res.status(400).json({ success: false, message: 'Reply content is required' });
      return;
    }

    const ticket = await SupportTicket.findById(id);

    if (!ticket) {
      res.status(404).json({ success: false, message: 'Ticket not found' });
      return;
    }

    ticket.replies.push(`Admin: ${reply}`);
    
    if (resolve) {
      ticket.status = 'Resolved';
    }

    await ticket.save();

    res.status(200).json({ success: true, message: 'Reply sent', data: { ticket } });
  } catch (error) {
    req.log.error(error, 'Error replying to ticket');
    res.status(500).json({ success: false, message: 'Failed to reply to ticket' });
  }
};
