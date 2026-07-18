import type { Request, Response } from 'express';
import { Transaction } from '../../models/Transaction';

/**
 * GET /api/v1/admin/revenue
 * Get revenue aggregates
 */
export const getRevenue = async (req: Request, res: Response): Promise<void> => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Aggregate MTD revenue
    const revenueStats = await Transaction.aggregate([
      {
        $match: {
          status: 'SUCCESS',
          createdAt: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' }
        }
      }
    ]);

    let subscriptions = 0;
    let appointments = 0;

    revenueStats.forEach(stat => {
      if (stat._id === 'SUBSCRIPTION') subscriptions = stat.total;
      if (stat._id === 'APPOINTMENT') appointments = stat.total;
    });

    const total = subscriptions + appointments;

    res.status(200).json({ 
      success: true, 
      data: { 
        mtdTotal: total,
        subscriptions,
        appointments
      } 
    });
  } catch (error) {
    req.log.error(error, 'Error fetching revenue stats');
    res.status(500).json({ success: false, message: 'Failed to fetch revenue stats' });
  }
};
