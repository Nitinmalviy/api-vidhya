import { Router } from 'express';
import { Appointment } from '../../../models/Appointment';
import { authenticate } from '../../../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const patientId = (req as any).user.id;
    const today = new Date().toISOString().split('T')[0];

    const upcomingAppointments = await Appointment.find({
      patientId,
      status: { $in: ['BOOKED'] },
      date: { $gte: today }
    })
      .sort({ date: 1, timeSlot: 1 })
      .limit(1)
      .populate('doctorId', 'name photoUrl specializations');

    res.status(200).json({ 
      success: true, 
      data: {
         upcomingAppointment: upcomingAppointments.length > 0 ? upcomingAppointments[0] : null,
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching dashboard' });
  }
});

export default router;
