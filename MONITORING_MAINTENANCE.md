# Monitoring and Maintenance Guide for Freight Calculator on Render

This guide provides simple instructions for monitoring and maintaining your Freight Calculator application deployed on Render.

## Monitoring Your Application

### Render Dashboard Monitoring

Render provides built-in monitoring capabilities:

1. Log in to your [Render Dashboard](https://dashboard.render.com)
2. Select your web service (freight-calculator)
3. Go to the "Metrics" tab to view:
   - CPU usage
   - Memory usage
   - Request volume
   - Response times
   - Error rates

### Health Check Endpoint

The application includes a health check endpoint that you can use to monitor its status:

```
https://your-app-name.onrender.com/api/health
```

This endpoint returns a JSON response with the current status of the application.

### Setting Up External Monitoring (Optional)

For more comprehensive monitoring, you can use a free service like UptimeRobot:

1. Create an account at [UptimeRobot](https://uptimerobot.com/)
2. Add a new monitor:
   - Monitor Type: HTTP(s)
   - Friendly Name: Freight Calculator
   - URL: https://your-app-name.onrender.com/api/health
   - Monitoring Interval: 5 minutes
3. Set up alert contacts to receive notifications when your application is down

## Regular Maintenance Tasks

### Checking Application Logs

To view application logs:

1. Go to your Render Dashboard
2. Select your web service
3. Go to the "Logs" tab
4. Review logs for errors or warnings

### Database Maintenance

Render automatically handles most PostgreSQL maintenance tasks, including:
- Backups (daily)
- Updates and patches
- Performance optimization

For manual database maintenance, refer to the DATABASE_CONFIG.md file.

### Updating the Application

When you need to update your application:

1. Make changes to your code in your GitHub repository
2. Commit and push the changes
3. Render will automatically detect the changes and redeploy your application

To monitor the deployment:
1. Go to your Render Dashboard
2. Select your web service
3. Go to the "Deploys" tab
4. Check the status of the latest deployment

### Restarting the Application

If you need to restart your application:

1. Go to your Render Dashboard
2. Select your web service
3. Click the "Manual Deploy" button
4. Select "Clear build cache & deploy"

## Troubleshooting Common Issues

### Application Not Responding

If your application is not responding:

1. Check the application logs in the Render Dashboard
2. Verify that your database is running
3. Check if you've reached the limits of the free tier (e.g., bandwidth)
4. Restart the application using the steps above

### Slow Performance

If your application is running slowly:

1. Check the metrics in the Render Dashboard for resource usage
2. Consider upgrading to a paid plan if you're consistently hitting resource limits
3. Check database query performance in the logs
4. Consider implementing caching for frequently accessed data

### Database Connection Issues

If your application can't connect to the database:

1. Verify that the `DATABASE_URL` environment variable is correct
2. Check if your database is running in the Render Dashboard
3. Check if you've reached the connection limit of your database plan

## Scaling Your Application

### When to Scale

Consider scaling your application when:
- Response times consistently increase
- You see frequent resource limit warnings in the logs
- Your user base grows significantly

### How to Scale on Render

To scale your application on Render:

1. Go to your Render Dashboard
2. Select your web service
3. Go to the "Settings" tab
4. Under "Instance Type", select a higher tier
5. Click "Save Changes"

For database scaling:
1. Go to your Render Dashboard
2. Select your PostgreSQL database
3. Go to the "Settings" tab
4. Under "Instance Type", select a higher tier
5. Click "Save Changes"

## Security Maintenance

### Regular Security Tasks

1. **Update Admin Password Regularly**:
   - Go to your Render Dashboard
   - Select your web service
   - Go to the "Environment" tab
   - Update the `ADMIN_PASSWORD` variable

2. **Review Access Logs**:
   - Check the logs in the Render Dashboard for suspicious activity
   - Look for repeated failed login attempts to the admin area

3. **Keep Dependencies Updated**:
   - Periodically update the npm packages in your application
   - Push the updates to GitHub to trigger a redeployment

## Support and Help

If you encounter issues that you can't resolve:

1. Check the [Render Documentation](https://render.com/docs)
2. Contact Render Support through your dashboard
3. Email support@tsp-transport.com for application-specific assistance

## Monthly Maintenance Checklist

For best results, perform these tasks monthly:

- [ ] Review application logs for errors
- [ ] Check resource usage metrics
- [ ] Verify database backups are being created
- [ ] Test the admin dashboard functionality
- [ ] Update admin password
- [ ] Test the health check endpoint
- [ ] Check for any pending updates or security patches
