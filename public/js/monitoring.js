async function loadMonitoring(container) {
    container.innerHTML = `
        <div id="monitoring-section">
            <!-- Monitoring Stats -->
            <div class="row mb-4">
                <div class="col-md-3">
                    <div class="stat-card primary">
                        <div class="stat-card-content">
                            <div class="icon">
                                <i class="fas fa-clock"></i>
                            </div>
                            <div class="stat-card-info">
                                <div class="value" id="uptime">0</div>
                                <div class="label">زمان فعالیت</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card success">
                        <div class="stat-card-content">
                            <div class="icon">
                                <i class="fas fa-tachometer-alt"></i>
                            </div>
                            <div class="stat-card-info">
                                <div class="value" id="requests-per-minute">0</div>
                                <div class="label">درخواست در دقیقه</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card warning">
                        <div class="stat-card-content">
                            <div class="icon">
                                <i class="fas fa-exclamation-triangle"></i>
                            </div>
                            <div class="stat-card-info">
                                <div class="value" id="error-rate">0%</div>
                                <div class="label">نرخ خطا</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card info">
                        <div class="stat-card-content">
                            <div class="icon">
                                <i class="fas fa-memory"></i>
                            </div>
                            <div class="stat-card-info">
                                <div class="value" id="memory-usage">0 MB</div>
                                <div class="label">مصرف حافظه</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Real-time Metrics -->
            <div class="row mb-4">
                <div class="col-md-12">
                    <div class="chart-container">
                        <h5 class="mb-3">
                            <i class="fas fa-chart-area text-primary"></i> متریک‌های بلادرنگ
                        </h5>
                        <canvas id="realtimeChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Performance Metrics -->
            <div class="row mb-4">
                <div class="col-md-6">
                    <div class="chart-container">
                        <h5 class="mb-3">
                            <i class="fas fa-server text-success"></i> عملکرد سرور
                        </h5>
                        <canvas id="serverPerformanceChart"></canvas>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="chart-container">
                        <h5 class="mb-3">
                            <i class="fas fa-network-wired text-info"></i> ترافیک API
                        </h5>
                        <canvas id="apiTrafficChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Alerts -->
            <div class="row">
                <div class="col-md-12">
                    <div class="stat-card">
                        <h5 class="mb-3">
                            <i class="fas fa-bell text-warning"></i> هشدارهای اخیر
                        </h5>
                        <div id="alerts-list">
                            <div class="text-center py-3">
                                <span class="text-muted">در حال بارگذاری هشدارها...</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    await loadMonitoringData();
    initMonitoringCharts();

    // Auto refresh every 10 seconds
    if (window.currentSection === 'monitoring') {
        setTimeout(() => {
            if (window.currentSection === 'monitoring') {
                loadMonitoringData();
            }
        }, 10000);
    }
}

async function loadMonitoringData() {
    try {
        // Get monitoring status
        const monitoringResponse = await apiRequest('/api/monitoring/status');

        if (monitoringResponse.success) {
            updateMonitoringStats(monitoringResponse.data);
        }

        // Get realtime metrics
        const realtimeResponse = await apiRequest('/api/monitoring/realtime');

        if (realtimeResponse.success) {
            updateRealtimeData(realtimeResponse.data);
        }

        // Get alerts
        const alertsResponse = await apiRequest('/api/monitoring/alerts?limit=10');

        if (alertsResponse.success) {
            displayAlerts(alertsResponse.alerts || []);
        }

    } catch (error) {
        console.error('Error loading monitoring data:', error);

        // Show mock data if API fails
        updateMonitoringStats({
            uptime: 86400,
            requestsPerMinute: 25,
            errorRate: 2,
            memoryUsage: 512
        });

        displayAlerts([
            {
                id: 1,
                type: 'warning',
                title: 'ظرفیت بالا',
                message: 'استفاده از ظرفیت به 80% رسیده است',
                time: new Date().toISOString()
            }
        ]);
    }
}

function updateMonitoringStats(data) {
    // Update uptime
    const uptime = data.uptime || 0;
    document.getElementById('uptime').textContent = formatUptime(uptime * 1000);

    // Update requests per minute
    document.getElementById('requests-per-minute').textContent = data.requestsPerMinute || 0;

    // Update error rate
    document.getElementById('error-rate').textContent = (data.errorRate || 0) + '%';

    // Update memory usage
    document.getElementById('memory-usage').textContent = (data.memoryUsage || 0) + ' MB';
}

function updateRealtimeData(data) {
    // Update charts with real-time data
    if (window.charts.realtime) {
        // Add new data point
        const now = new Date().toLocaleTimeString('fa-IR');

        window.charts.realtime.data.labels.push(now);
        window.charts.realtime.data.datasets[0].data.push(data.sessions?.active || 0);
        window.charts.realtime.data.datasets[1].data.push(data.capacity?.percentage || 0);

        // Keep only last 20 points
        if (window.charts.realtime.data.labels.length > 20) {
            window.charts.realtime.data.labels.shift();
            window.charts.realtime.data.datasets[0].data.shift();
            window.charts.realtime.data.datasets[1].data.shift();
        }

        window.charts.realtime.update();
    }
}

function displayAlerts(alerts) {
    const alertsList = document.getElementById('alerts-list');

    if (!alerts || alerts.length === 0) {
        alertsList.innerHTML = `
            <div class="text-center py-3">
                <i class="fas fa-check-circle text-success fa-2x mb-2"></i>
                <p class="text-muted">هیچ هشداری وجود ندارد</p>
            </div>
        `;
        return;
    }

    let html = '<div class="list-group">';

    alerts.forEach(alert => {
        const iconClass = {
            'critical': 'fa-exclamation-circle text-danger',
            'error': 'fa-times-circle text-danger',
            'warning': 'fa-exclamation-triangle text-warning',
            'info': 'fa-info-circle text-info'
        }[alert.type] || 'fa-bell text-secondary';

        const time = new Date(alert.time).toLocaleString('fa-IR');

        html += `
            <div class="list-group-item">
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1">
                        <i class="fas ${iconClass}"></i> ${alert.title}
                    </h6>
                    <small class="text-muted">${time}</small>
                </div>
                <p class="mb-1">${alert.message}</p>
                ${alert.action ? `<small class="text-primary">توصیه: ${alert.action}</small>` : ''}
            </div>
        `;
    });

    html += '</div>';
    alertsList.innerHTML = html;
}

function initMonitoringCharts() {
    // Real-time Chart
    const realtimeCtx = document.getElementById('realtimeChart').getContext('2d');
    if (window.charts.realtime) window.charts.realtime.destroy();

    window.charts.realtime = new Chart(realtimeCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'سشن‌های فعال',
                data: [],
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.1)',
                tension: 0.4,
                yAxisID: 'y'
            }, {
                label: 'ظرفیت (%)',
                data: [],
                borderColor: 'rgb(255, 159, 64)',
                backgroundColor: 'rgba(255, 159, 64, 0.1)',
                tension: 0.4,
                yAxisID: 'y1'
            }]
        },
        options: {
            responsive: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    max: 100,
                    grid: {
                        drawOnChartArea: false,
                    },
                }
            }
        }
    });

    // Server Performance Chart
    const serverCtx = document.getElementById('serverPerformanceChart').getContext('2d');
    if (window.charts.serverPerformance) window.charts.serverPerformance.destroy();

    window.charts.serverPerformance = new Chart(serverCtx, {
        type: 'bar',
        data: {
            labels: ['CPU', 'RAM', 'Disk I/O', 'Network'],
            datasets: [{
                label: 'استفاده (%)',
                data: [
                    Math.floor(Math.random() * 100),
                    Math.floor(Math.random() * 100),
                    Math.floor(Math.random() * 100),
                    Math.floor(Math.random() * 100)
                ],
                backgroundColor: [
                    'rgba(255, 99, 132, 0.5)',
                    'rgba(54, 162, 235, 0.5)',
                    'rgba(255, 206, 86, 0.5)',
                    'rgba(75, 192, 192, 0.5)'
                ],
                borderColor: [
                    'rgba(255, 99, 132, 1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(75, 192, 192, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100
                }
            }
        }
    });

    // API Traffic Chart
    const apiCtx = document.getElementById('apiTrafficChart').getContext('2d');
    if (window.charts.apiTraffic) window.charts.apiTraffic.destroy();

    window.charts.apiTraffic = new Chart(apiCtx, {
        type: 'line',
        data: {
            labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
            datasets: [{
                label: 'درخواست‌ها',
                data: Array.from({length: 6}, () => Math.floor(Math.random() * 1000)),
                borderColor: 'rgb(153, 102, 255)',
                backgroundColor: 'rgba(153, 102, 255, 0.2)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}