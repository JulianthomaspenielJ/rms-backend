// models/hrDetailsModel.js
module.exports = {
  tableName: process.env.DDB_HR_DETAILS_TABLE || 'tb_hr_details',
  buildItem({ id, hr_id, department, designation, employee_id, joining_date, linkedIn_url, phone_number, reporting_manager, work_location, status, created_at, created_by, updated_at, updated_by }) {
    return {
      id,
      hr_id,
      department,
      designation,
      employee_id,
      joining_date,
      linkedIn_url,
      phone_number,
      reporting_manager,
      work_location,
      status: status ?? '1',
      created_at,
      created_by,
      updated_at,
      updated_by
    };
  }
};


