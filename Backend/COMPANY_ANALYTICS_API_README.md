# Company Analytics Dashboard API Documentation

## Overview
This document describes the API endpoints for the Company Admin Dashboard analytics. These APIs provide real-time data for the dashboard charts and statistics, replacing the previously hardcoded data.

## Base URL
All endpoints are prefixed with `/api/companies/analytics/`

## Authentication
All endpoints require authentication via Bearer token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## API Endpoints

### 1. Dashboard Overview
**Endpoint**: `GET /api/companies/analytics/dashboard`

**Description**: Returns comprehensive dashboard data including totals and chart data.

**Response**:
```json
{
  "ok": true,
  "data": {
    "totals": {
      "totalJDs": 45,
      "totalApplicants": 850
    },
    "graphs": {
      "jdVsMonths": [
        {
          "month": "2024-01",
          "jdCount": 12
        },
        {
          "month": "2024-02", 
          "jdCount": 18
        }
      ],
      "jdByHR": [
        {
          "hrId": "hr-123",
          "count": 10,
          "name": "John Doe"
        }
      ],
      "applicationsByDepartment": [
        {
          "name": "Engineering",
          "value": 120
        }
      ]
    }
  }
}
```

**Data Sources**:
- **totalJDs**: Count of job descriptions created by HRs in the company
- **totalApplicants**: Count of applications in shortlist table
- **jdVsMonths**: Job descriptions grouped by month (YYYY-MM format)
- **jdByHR**: Job descriptions grouped by HR user
- **applicationsByDepartment**: Applications grouped by department from HR details

---

### 2. Summary Statistics
**Endpoint**: `GET /api/companies/analytics/summary`

**Description**: Returns basic summary statistics (totals only).

**Response**:
```json
{
  "ok": true,
  "data": {
    "totalJDs": 45,
    "totalApplicants": 850
  }
}
```

---

### 3. Chart Data
**Endpoint**: `GET /api/companies/analytics/graphs`

**Description**: Returns detailed chart data for dashboard visualizations.

**Response**:
```json
{
  "ok": true,
  "data": {
    "jdVsMonths": [
      {
        "month": "2024-01",
        "jdCount": 12
      }
    ],
    "jdByHR": [
      {
        "hrId": "hr-123",
        "count": 10,
        "name": "John Doe"
      }
    ],
    "applicationsByDepartment": [
      {
        "name": "Engineering",
        "value": 120
      }
    ]
  }
}
```

---

## Frontend Integration

### Updated Dashboard Component
The frontend dashboard component (`Frontend/src/pages/companyAdmin/HR/Home.jsx`) has been updated to:

1. **Fetch Real Data**: Replaced hardcoded data with API calls
2. **Loading States**: Added loading spinner while fetching data
3. **Error Handling**: Added error states with retry functionality
4. **Data Transformation**: Transforms API data to chart-compatible format

### Key Changes Made:

#### Backend Changes:
- ✅ Added analytics routes to `Backend/routes/companyRoute.js`
- ✅ Integrated existing `companyAnalyticsController.js` with new routes
- ✅ Routes now available at:
  - `GET /api/companies/analytics/dashboard`
  - `GET /api/companies/analytics/summary`
  - `GET /api/companies/analytics/graphs`

#### Frontend Changes:
- ✅ Added API configuration and fetch function
- ✅ Replaced hardcoded data arrays with API calls
- ✅ Added loading and error states
- ✅ Data transformation for chart compatibility
- ✅ Real-time totals display

---

## Database Tables Used

The analytics API queries the following DynamoDB tables:

1. **tb_users** - To find HR users for the company
2. **tb_job_descriptions** - To count and analyze job descriptions
3. **tb_shortlist** - To count applications
4. **tb_hr_details** - To get department information

---

## Testing

Use the provided test script to verify the API endpoints:

```bash
cd Backend
node test-company-analytics.js
```

**Note**: Update the `TEST_TOKEN` variable in the test script with a valid JWT token from your authentication system.

---

## Error Handling

The API returns standardized error responses:

```json
{
  "ok": false,
  "error": "ErrorType",
  "message": "Human readable error message"
}
```

Common error scenarios:
- **401 Unauthorized**: Missing or invalid authentication token
- **403 Forbidden**: User not associated with any company
- **500 Internal Server Error**: Database or server issues

---

## Data Flow

1. **Authentication**: Frontend sends JWT token in Authorization header
2. **Company Resolution**: Backend resolves company ID from authenticated user
3. **HR Filtering**: Finds all HR users belonging to the company
4. **Data Aggregation**: Queries job descriptions, applications, and HR details
5. **Data Transformation**: Formats data for frontend consumption
6. **Response**: Returns structured JSON with totals and chart data

---

## Performance Considerations

- Uses parallel database queries (`Promise.all`) for optimal performance
- Filters data at database level to minimize data transfer
- Efficient data aggregation using JavaScript Maps and Objects
- Caches HR user lookups to avoid repeated database calls

---

## Future Enhancements

Potential improvements for the analytics API:

1. **Date Filtering**: Add query parameters for date range filtering
2. **Caching**: Implement Redis caching for frequently accessed data
3. **Real-time Updates**: WebSocket integration for live dashboard updates
4. **Advanced Analytics**: Additional metrics like conversion rates, time-to-hire
5. **Export Functionality**: PDF/Excel export of dashboard data
