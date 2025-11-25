# Super Admin Dashboard APIs - Complete Documentation

## Overview
This document describes all the APIs needed for the Super Admin Dashboard. These APIs provide real-time data for statistics, charts, and tables displayed on the dashboard.

## API Endpoints

### **Base URL**: `/api/dashboard`

All endpoints require **Super Admin** authentication via Bearer token.

---

## **1. Dashboard Overview Statistics**

### **Endpoint**: `GET /api/dashboard/overview`

**Description**: Get key statistics for the dashboard stat cards.

**Response**:
```json
{
  "ok": true,
  "message": "Dashboard overview retrieved successfully",
  "data": {
    "companies": 18,
    "totalUsers": 293,
    "recruiters": 45,
    "candidates": 230,
    "feedbackLastWeek": 18
  }
}
```

**Data Sources**:
- **Companies**: Total count from `tb_company`
- **Total Users**: Total count of all users from `tb_users`
- **Recruiters**: Users with `user_role = 'hr'` from `tb_users`
- **Candidates**: Users with `user_role = 'candidate'` from `tb_users`
- **Feedback Last Week**: Feedbacks created in the last 7 days from `tb_feedbacks`

---

## **2. User Registration Trends**

### **Endpoint**: `GET /api/dashboard/user-trends`

**Description**: Get user registration trends for charts.

**Query Parameters**:
- `period` (optional): `weekly` | `monthly` | `daily` (default: `weekly`)

**Examples**:
```bash
GET /api/dashboard/user-trends
GET /api/dashboard/user-trends?period=monthly
GET /api/dashboard/user-trends?period=daily
```

**Response**:
```json
{
  "ok": true,
  "message": "User trends retrieved successfully",
  "data": [
    { "name": "2025-01-20", "users": 5 },
    { "name": "2025-01-21", "users": 8 },
    { "name": "2025-01-22", "users": 12 }
  ],
  "period": "weekly",
  "totalDays": 7
}
```

**Data Format**:
- **Weekly**: Last 7 days, grouped by day
- **Monthly**: Last 30 days, grouped by day
- **Daily**: Last 7 days, grouped by day

---

## **3. Members Overview Chart**

### **Endpoint**: `GET /api/dashboard/members-overview`

**Description**: Get members overview with trends for Jobseekers vs Recruiters chart.

**Query Parameters**:
- `period` (optional): `monthly` | `weekly` | `daily` (default: `monthly`)

**Examples**:
```bash
GET /api/dashboard/members-overview
GET /api/dashboard/members-overview?period=weekly
GET /api/dashboard/members-overview?period=daily
```

**Response**:
```json
{
  "ok": true,
  "message": "Members overview retrieved successfully",
  "data": [
    {
      "name": "Jan",
      "Jobseekers": 130,
      "Recruiters": 10
    },
    {
      "name": "Feb",
      "Jobseekers": 125,
      "Recruiters": 12
    }
  ],
  "period": "monthly",
  "totalMonths": 12
}
```

**Data Format**:
- **Monthly**: Last 12 months, grouped by month
- **Weekly**: Last 4 weeks, grouped by week
- **Daily**: Last 7 days, grouped by day

---

## **4. Recent Data Tables**

### **Endpoint**: `GET /api/dashboard/recent-data`

**Description**: Get recent data for dashboard tables.

**Query Parameters**:
- `limit` (optional): Number of records to return (default: 5)

**Examples**:
```bash
GET /api/dashboard/recent-data
GET /api/dashboard/recent-data?limit=10
```

**Response**:
```json
{
  "ok": true,
  "message": "Recent data retrieved successfully",
  "data": {
    "candidates": [
      {
        "name": "John Doe",
        "email": "john@example.com",
        "joined": "2025-01-20"
      }
    ],
    "recruiters": [
      {
        "name": "Mike Johnson",
        "email": "mike@example.com",
        "joined": "2025-01-21"
      }
    ],
    "companies": [
      {
        "name": "TechSoft Inc",
        "email": "contact@techsoft.com",
        "joined": "2025-01-19"
      }
    ],
    "feedbacks": [
      {
        "name": "Rahul",
        "message": "Great platform! Easy to navigate...",
        "date": "2025-01-23"
      }
    ]
  }
}
```

---

## **5. Comprehensive Analytics**

### **Endpoint**: `GET /api/dashboard/analytics`

**Description**: Get comprehensive dashboard analytics and statistics.

**Response**:
```json
{
  "ok": true,
  "message": "Dashboard analytics retrieved successfully",
  "data": {
    "stats": {
      "totalCompanies": 18,
      "totalUsers": 293,
      "totalFeedbacks": 45,
      "activeCompanies": 16,
      "activeUsers": 280,
      "userRoles": {
        "candidates": 230,
        "recruiters": 45,
        "companyAdmins": 12,
        "subAdmins": 6
      },
      "feedbackStats": {
        "total": 45,
        "happyCustomers": 38,
        "averageRating": "4.2"
      }
    },
    "monthlyGrowth": [
      {
        "month": "Jan",
        "users": 60,
        "companies": 3
      },
      {
        "month": "Feb",
        "users": 260,
        "companies": 5
      }
    ],
    "timestamp": "2025-01-23T10:30:00.000Z"
  }
}
```

---

## **6. Bulk Data Loading**

### **Frontend Helper**: `getAllDashboardData()`

**Description**: Fetch all dashboard data in parallel for optimal performance.

**Usage**:
```javascript
import { dashboardAPI } from '../api/dashboard';

try {
  const allData = await dashboardAPI.getAllDashboardData();
  // allData contains: overview, userTrends, membersOverview, recentData, analytics
} catch (error) {
  console.error('Error loading dashboard:', error);
}
```

---

## **Authentication & Security**

### **Required Headers**:
```http
Authorization: Bearer <super_admin_token>
Content-Type: application/json
```

### **Access Control**:
- **Super Admin Only**: All endpoints require `super_admin` or `superadmin` role
- **JWT Verification**: Tokens are verified via AWS Cognito or JWT
- **Role Validation**: Double-checked against user attributes

---

## **Data Sources & Tables**

### **Primary Tables**:
1. **`tb_users`**: User information and roles
2. **`tb_company`**: Company information
3. **`tb_feedbacks`**: User feedback and ratings

### **Key Fields**:
- **User Role**: `user_role` (candidate, hr, company_admin, sub_admin)
- **Status**: `status`, `active_status`
- **Timestamps**: `created_at`, `updated_at`

---

## **Performance Considerations**

### **Optimizations**:
- **Parallel Queries**: Multiple DynamoDB scans run concurrently
- **Filtering**: Data filtered at application level for flexibility
- **Caching**: Frontend can cache data and refresh periodically
- **Pagination**: Recent data supports limit parameter

### **Monitoring**:
- **Response Times**: Track API performance
- **Error Rates**: Monitor for data inconsistencies
- **Data Freshness**: Timestamps included for cache validation

---

## **Error Handling**

### **Common Error Responses**:
```json
{
  "ok": false,
  "error": "UnauthorizedError",
  "message": "Only super admin can access this resource"
}
```

### **HTTP Status Codes**:
- **200**: Success
- **401**: Unauthorized (missing/invalid token)
- **403**: Forbidden (insufficient role)
- **500**: Internal Server Error

---

## **Frontend Integration**

### **React Hook Example**:
```javascript
import { useState, useEffect } from 'react';
import { dashboardAPI } from '../api/dashboard';

const useDashboardData = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        setLoading(true);
        const dashboardData = await dashboardAPI.getAllDashboardData();
        setData(dashboardData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  return { data, loading, error };
};
```

---

## **Testing & Development**

### **Local Testing**:
```bash
# Test overview endpoint
curl -H "Authorization: Bearer <token>" \
     http://localhost:4000/api/dashboard/overview

# Test with query parameters
curl -H "Authorization: Bearer <token>" \
     "http://localhost:4000/api/dashboard/user-trends?period=monthly"
```

### **Environment Variables**:
```bash
# Required for authentication
COGNITO_USER_POOL_ID=your_user_pool_id
COGNITO_CLIENT_ID=your_client_id
JWT_SECRET=your_jwt_secret

# DynamoDB table names
DDB_USERS_TABLE=tb_users
DDB_COMPANY_TABLE=tb_company
DDB_FEEDBACK_TABLE=tb_feedbacks
```

---

## **Future Enhancements**

1. **Real-time Updates**: WebSocket integration for live data
2. **Advanced Filtering**: Date ranges, user segments, etc.
3. **Export Functionality**: CSV/PDF reports
4. **Custom Dashboards**: User-configurable widgets
5. **Performance Metrics**: API response time monitoring
6. **Data Analytics**: Advanced insights and predictions

---

## **Support & Troubleshooting**

For issues or questions:
1. Check authentication token validity
2. Verify user has super admin role
3. Ensure DynamoDB tables exist and are accessible
4. Review CloudWatch logs for backend errors
5. Check frontend console for API call errors

---

**🎯 These APIs provide everything needed to build a comprehensive, real-time Super Admin Dashboard!**
