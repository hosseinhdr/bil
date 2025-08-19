// Enhanced Dashboard with Real-time Updates
async function loadDashboard(container) {
    container.innerHTML = `
        <div id="dashboard-section">
            <!-- Real-time Stats Cards -->
            <div class="row mb-4">
                <div class="col-md-3 mb-3">
                    <div class="stat-card glass-card primary">
                        <div class="stat-card-content">
                            <div class="icon">
                                <i class="fas fa-users"></i>
                            </div>
                            <div class="stat-card-info">
                                <div class="value" id="total-sessions">
                                    <span class="counter" data-target="0">0</span>
                                </div>
                                <div class="label">کل سشن‌ها</div>
                            </div>
                        </div>
                        <div class="live-indicator"></div>
                    </div>
                </div>
                <div class="col-md-3 mb-3">
                    <div class="stat-card glass-card success">
                        <div class="stat-card-content">
                            <div class="icon">
                                <i class="fas fa-check-circle"></i>
                            </div>
                            <div class="stat-card-info">
                                <div class="value" id="active-sessions">
                                    <span class="counter" data-target="0">0</span>
                                </div>
                                <div class="label">سشن‌های فعال</div>
                            </div>
                        </div>
                        <div class="capacity-bar">
                            <div class="capacity-fill" id="active-sessions-bar" style="width: 0%"></div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3 mb-3">
                    <div class="stat-card glass-card warning">
                        <div class="stat-card-content">
                            <div class="icon">
                                <i class="fas fa-broadcast-tower"></i>
                            </div>
                            <div class="stat-card-info">
                                <div class="value" id="total-channels">
                                    <span class="counter" data-target="0">0</span>
                                </div>
                                <div class="label">کل کانال‌ها</div>
                            </div>
                        </div>
                        <div class="sparkline" id="channels-sparkline"></div>
                    </div>
                </div>
                <div class="col-md-3 mb-3">
                    <div class="stat-card glass-card info">
                        <div class="stat-card-content">
                            <div class="icon">
                                <i class="fas fa-chart-pie"></i>
                            </div>
                            <div class="stat-card-info">
                                <div class="value" id="capacity-usage">
                                    <span class="counter" data-target="0">0</span>%
                                </div>
                                <div class="label">ظرفیت استفاده شده</div>
                            </div>
                        </div>
                        <canvas id="capacityGauge" style="width: 100%; height: 80px;"></canvas>
                    </div>
                </div>
            </div>

            <!-- Live Activity Feed & Performance Monitor -->
            <div class="row mb-4">
                <div class="col-md-8">
                    <div class="chart-container glass-card">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h5 class="mb-0">
                                <i class="fas fa-chart-area text-primary"></i> عملکرد بلادرنگ
                            </h5>
                            <div class="btn-group" role="group">
                                <button class="btn btn-sm btn-outline-primary active" onclick="updatePerformanceChart('1h')">1 ساعت</button>
                                <button class="btn btn-sm btn-outline-primary" onclick="updatePerformanceChart('24h')">24 ساعت</button>
                                <button class="btn btn-sm btn-outline-primary" onclick="updatePerformanceChart('7d')">7 روز</button>
                            </div>
                        </div>
                        <canvas id="performanceChart"></canvas>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="chart-container glass-card" style="height: 400px; overflow-y: auto;">
                        <h5 class="mb-3">
                            <i class="fas fa-stream text-success"></i> فعالیت‌های زنده
                            <span class="badge bg-danger ms-2 live-indicator"></span>
                        </h5>
                        <div id="activityFeed" class="activity-feed">
                            <!-- Activity items will be added here -->
                        </div>
                    </div>
                </div>
            </div>

            <!-- Session Heat Map & Auto-Optimization -->
            <div class="row mb-4">
                <div class="col-md-6">
                    <div class="chart-container glass-card">
                        <h5 class="mb-3">
                            <i class="fas fa-th text-warning"></i> نقشه حرارتی سشن‌ها
                        </h5>
                        <div id="sessionHeatmap"></div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="chart-container glass-card">
                        <h5 class="mb-3">
                            <i class="fas fa-magic text-info"></i> بهینه‌سازی خودکار
                        </h5>
                        <div id="autoOptimization">
                            <div class="optimization-status mb-3">
                                <div class="d-flex justify-content-between align-items-center">
                                    <span>وضعیت بهینه‌سازی</span>
                                    <span class="badge bg-success">فعال</span>
                                </div>
                                <div class="progress mt-2">
                                    <div class="progress-bar progress-bar-striped progress-bar-animated" style="width: 75%">75%</div>
                                </div>
                            </div>
                            <div class="optimization-suggestions">
                                <div class="suggestion-item">
                                    <i class="fas fa-lightbulb text-warning"></i>
                                    <span>انتقال 15 کانال از session_1 به session_2 برای توزیع بهتر بار</span>
                                    <button class="btn btn-sm btn-success ms-2" onclick="applyOptimization('balance')">
                                        <i class="fas fa-check"></i> اعمال
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Quick Actions with Enhanced UI -->
            <div class="row mb-4">
                <div class="col-md-12">
                    <div class="stat-card glass-card">
                        <h5 class="mb-3">
                            <i class="fas fa-bolt text-warning"></i> دسترسی سریع
                        </h5>
                        <div class="row">
                            <div class="col-md-3 mb-2">
                                <button class="btn btn-primary quick-action-btn" onclick="showAddSessionModal()">
                                    <i class="fas fa-plus"></i> افزودن سشن
                                </button>
                            </div>
                            <div class="col-md-3 mb-2">
                                <button class="btn btn-success quick-action-btn" onclick="showJoinChannelModal()">
                                    <i class="fas fa-sign-in-alt"></i> عضویت در کانال
                                </button>
                            </div>
                            <div class="col-md-3 mb-2">
                                <button class="btn btn-warning quick-action-btn" onclick="showCleanupModal()">
                                    <i class="fas fa-broom"></i> پاکسازی کانال‌ها
                                </button>
                            </div>
                            <div class="col-md-3 mb-2">
                                <button class="btn btn-info quick-action-btn" onclick="exportData()">
                                    <i class="fas fa-download"></i> دانلود گزارش
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Alert Center -->
            <div class="row">
                <div class="col-md-12">
                    <div class="chart-container glass-card">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h5 class="mb-0">
                                <i class="fas fa-bell text-danger"></i> مرکز هشدارها
                            </h5>
                            <button class="btn btn-sm btn-outline-danger" onclick="configureAlerts()">
                                <i class="fas fa-cog"></i> تنظیمات
                            </button>
                        </div>
                        <div id="alertCenter">
                            <!-- Alerts will be loaded here -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Initialize all components
    await loadDashboardData();
    initDashboardCharts();
    startRealtimeUpdates();
    initCounterAnimations();
    loadActivityFeed();
    loadAlertCenter();
    initSessionHeatmap();
}

// Counter Animation
function initCounterAnimations() {
    const counters = document.querySelectorAll('.counter');

    counters.forEach(counter => {
        const target = parseInt(counter.getAttribute('data-target'));
        const increment = target / 100;
        let current = 0;

        const updateCounter = () => {
            current += increment;
            if (current < target) {
                counter.textContent = Math.ceil(current);
                requestAnimationFrame(updateCounter);
            } else {
                counter.textContent = target;
            }
        };

        updateCounter();
    });
}

// Real-time Updates
function startRealtimeUpdates() {
    // Update every 5 seconds
    setInterval(async () => {
        await updateDashboardMetrics();
        updateActivityFeed();
    }, 5000);

    // Update charts every 10 seconds
    setInterval(() => {
        updatePerformanceChart();
    }, 10000);
}

// Load Dashboard Data
async function loadDashboardData() {
    try {
        const sessionStatus = await apiRequest('/api/session/status');
        if (sessionStatus.success) {
            updateDashboardStats(sessionStatus.data);
        }

        const capacityStats = await apiRequest('/api/session/capacity');
        if (capacityStats) {
            updateCapacityGauge(capacityStats);
        }

        const healthResponse = await fetch('/health');
        if (healthResponse.ok) {
            const health = await healthResponse.json();
            updateHealthStatus(health);
        }
    } catch (error) {
        console.error('Dashboard data error:', error);
    }
}

// Update Dashboard Stats
function updateDashboardStats(data) {
    // Update counters with animation
    updateCounter('total-sessions', data.total || 0);
    updateCounter('active-sessions', data.active || 0);
    updateCounter('total-channels', data.totalChannelsUsed || 0);

    const capacity = Math.round((data.totalChannelsUsed / data.totalCapacity) * 100) || 0;
    updateCounter('capacity-usage', capacity, '%');

    // Update progress bars
    const activeBar = document.getElementById('active-sessions-bar');
    if (activeBar) {
        const percentage = (data.active / data.total) * 100;
        activeBar.style.width = percentage + '%';
        activeBar.className = 'capacity-fill';
        if (percentage < 50) activeBar.classList.add('danger');
        else if (percentage < 80) activeBar.classList.add('warning');
    }
}

// Update single counter with animation
function updateCounter(id, value, suffix = '') {
    const element = document.querySelector(`#${id} .counter`);
    if (element) {
        element.setAttribute('data-target', value);
        const current = parseInt(element.textContent);
        const increment = (value - current) / 20;

        let step = current;
        const updateValue = () => {
            step += increment;
            if ((increment > 0 && step < value) || (increment < 0 && step > value)) {
                element.textContent = Math.round(step) + suffix;
                requestAnimationFrame(updateValue);
            } else {
                element.textContent = value + suffix;
            }
        };

        updateValue();
    }
}

// Initialize Dashboard Charts
function initDashboardCharts() {
    // Performance Chart
    const perfCtx = document.getElementById('performanceChart');
    if (perfCtx) {
        const ctx = perfCtx.getContext('2d');

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(102, 126, 234, 0.5)');
        gradient.addColorStop(1, 'rgba(102, 126, 234, 0)');

        window.charts.performance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: generateTimeLabels(24),
                datasets: [{
                    label: 'عملیات موفق',
                    data: generateRandomData(24, 50, 100),
                    borderColor: 'rgb(102, 126, 234)',
                    backgroundColor: gradient,
                    tension: 0.4,
                    fill: true
                }, {
                    label: 'خطاها',
                    data: generateRandomData(24, 0, 20),
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        padding: 12,
                        borderRadius: 8,
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }

    // Capacity Gauge
    initCapacityGauge();
}

// Initialize Capacity Gauge
function initCapacityGauge() {
    const canvas = document.getElementById('capacityGauge');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 30;

    function drawGauge(percentage) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background arc
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, Math.PI * 0.75, Math.PI * 2.25, false);
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.stroke();

        // Progress arc
        const endAngle = Math.PI * 0.75 + (Math.PI * 1.5 * percentage / 100);
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, Math.PI * 0.75, endAngle, false);
        ctx.lineWidth = 8;

        // Gradient based on percentage
        if (percentage < 50) {
            ctx.strokeStyle = '#00b09b';
        } else if (percentage < 80) {
            ctx.strokeStyle = '#f39c12';
        } else {
            ctx.strokeStyle = '#e74c3c';
        }
        ctx.stroke();
    }

    // Animate gauge
    let currentPercentage = 0;
    const targetPercentage = parseInt(document.querySelector('#capacity-usage .counter').textContent);

    const animateGauge = () => {
        if (currentPercentage < targetPercentage) {
            currentPercentage += 2;
            drawGauge(Math.min(currentPercentage, targetPercentage));
            requestAnimationFrame(animateGauge);
        }
    };

    animateGauge();
}

// Activity Feed
function loadActivityFeed() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    const activities = [
        { type: 'join', text: 'عضویت در کانال @example', time: 'همین الان', icon: 'fa-sign-in-alt', color: 'success' },
        { type: 'leave', text: 'خروج از کانال TestChannel', time: '2 دقیقه پیش', icon: 'fa-sign-out-alt', color: 'warning' },
        { type: 'error', text: 'خطا در اتصال session_2', time: '5 دقیقه پیش', icon: 'fa-exclamation-triangle', color: 'danger' },
        { type: 'info', text: 'بهینه‌سازی خودکار انجام شد', time: '10 دقیقه پیش', icon: 'fa-magic', color: 'info' }
    ];

    feed.innerHTML = activities.map(activity => `
        <div class="activity-item animate__animated animate__fadeIn">
            <div class="activity-icon text-${activity.color}">
                <i class="fas ${activity.icon}"></i>
            </div>
            <div class="activity-content">
                <div class="activity-text">${activity.text}</div>
                <div class="activity-time text-muted">${activity.time}</div>
            </div>
        </div>
    `).join('');
}

// Update Activity Feed
function updateActivityFeed() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    // Add new activity at the top
    const newActivity = {
        type: 'info',
        text: `عملیات جدید در ${new Date().toLocaleTimeString('fa-IR')}`,
        time: 'همین الان',
        icon: 'fa-bell',
        color: 'primary'
    };

    const activityHtml = `
        <div class="activity-item animate__animated animate__fadeIn">
            <div class="activity-icon text-${newActivity.color}">
                <i class="fas ${newActivity.icon}"></i>
            </div>
            <div class="activity-content">
                <div class="activity-text">${newActivity.text}</div>
                <div class="activity-time text-muted">${newActivity.time}</div>
            </div>
        </div>
    `;

    feed.insertAdjacentHTML('afterbegin', activityHtml);

    // Keep only last 10 items
    while (feed.children.length > 10) {
        feed.removeChild(feed.lastChild);
    }
}

// Alert Center
function loadAlertCenter() {
    const alertCenter = document.getElementById('alertCenter');
    if (!alertCenter) return;

    const alerts = [
        { level: 'danger', title: 'ظرفیت بحرانی', message: 'ظرفیت سیستم به 92% رسیده است', action: 'پاکسازی کانال‌ها' },
        { level: 'warning', title: 'سشن قطع شده', message: 'session_3 از 10 دقیقه پیش قطع است', action: 'اتصال مجدد' },
        { level: 'info', title: 'بروزرسانی موجود', message: 'نسخه جدید سیستم در دسترس است', action: 'مشاهده' }
    ];

    alertCenter.innerHTML = alerts.map(alert => `
        <div class="alert alert-${alert.level} d-flex justify-content-between align-items-center">
            <div>
                <strong>${alert.title}</strong> - ${alert.message}
            </div>
            <button class="btn btn-sm btn-${alert.level}" onclick="handleAlert('${alert.level}')">
                ${alert.action}
            </button>
        </div>
    `).join('');
}

// Session Heatmap
function initSessionHeatmap() {
    const heatmap = document.getElementById('sessionHeatmap');
    if (!heatmap) return;

    // Create heatmap grid
    const sessions = ['session_1', 'session_2', 'session_3', 'session_4'];
    const hours = Array.from({length: 24}, (_, i) => i);

    let html = '<div class="heatmap-grid">';

    sessions.forEach(session => {
        html += '<div class="heatmap-row">';
        html += `<div class="heatmap-label">${session}</div>`;

        hours.forEach(hour => {
            const intensity = Math.random();
            const color = getHeatmapColor(intensity);
            html += `<div class="heatmap-cell" style="background: ${color}" 
                     data-session="${session}" data-hour="${hour}" 
                     data-intensity="${Math.round(intensity * 100)}"></div>`;
        });

        html += '</div>';
    });

    html += '</div>';
    heatmap.innerHTML = html;

    // Add hover effects
    document.querySelectorAll('.heatmap-cell').forEach(cell => {
        cell.addEventListener('mouseenter', function() {
            const session = this.dataset.session;
            const hour = this.dataset.hour;
            const intensity = this.dataset.intensity;

            // Show tooltip
            this.title = `${session} - ساعت ${hour}: ${intensity}% فعالیت`;
        });
    });
}

// Get heatmap color based on intensity
function getHeatmapColor(intensity) {
    if (intensity < 0.2) return 'rgba(0, 176, 155, 0.2)';
    if (intensity < 0.4) return 'rgba(0, 176, 155, 0.4)';
    if (intensity < 0.6) return 'rgba(243, 156, 18, 0.6)';
    if (intensity < 0.8) return 'rgba(243, 156, 18, 0.8)';
    return 'rgba(231, 76, 60, 1)';
}

// Auto Optimization
async function applyOptimization(type) {
    Swal.fire({
        title: 'بهینه‌سازی خودکار',
        text: 'در حال اعمال بهینه‌سازی...',
        icon: 'info',
        allowOutsideClick: false,
        showConfirmButton: false,
        willOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        // Call optimization API
        const response = await apiRequest('/api/session/optimize', {
            method: 'POST',
            body: JSON.stringify({ type })
        });

        if (response.success) {
            Swal.fire({
                icon: 'success',
                title: 'بهینه‌سازی انجام شد',
                text: 'توزیع کانال‌ها بین سشن‌ها بهینه شد',
                confirmButtonText: 'تایید'
            });

            // Refresh dashboard
            await loadDashboardData();
        }
    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: 'خطا',
            text: 'خطا در اعمال بهینه‌سازی',
            confirmButtonText: 'بستن'
        });
    }
}

// Configure Alerts
function configureAlerts() {
    Swal.fire({
        title: 'تنظیمات هشدارها',
        html: `
            <div class="text-start">
                <div class="mb-3">
                    <label class="form-label">هشدار ظرفیت (درصد)</label>
                    <input type="range" class="form-range" min="50" max="100" value="80" id="capacity-threshold">
                    <small class="text-muted">هشدار در صورت رسیدن ظرفیت به این مقدار</small>
                </div>
                <div class="mb-3">
                    <label class="form-label">هشدار خطا (تعداد در ساعت)</label>
                    <input type="number" class="form-control" value="10" id="error-threshold">
                </div>
                <div class="mb-3">
                    <label class="form-label">روش‌های اطلاع‌رسانی</label>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="notify-telegram" checked>
                        <label class="form-check-label" for="notify-telegram">
                            پیام تلگرام
                        </label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="notify-email">
                        <label class="form-check-label" for="notify-email">
                            ایمیل
                        </label>
                    </div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'ذخیره',
        cancelButtonText: 'انصراف',
        confirmButtonColor: '#667eea',
        preConfirm: () => {
            const settings = {
                capacityThreshold: document.getElementById('capacity-threshold').value,
                errorThreshold: document.getElementById('error-threshold').value,
                notifyTelegram: document.getElementById('notify-telegram').checked,
                notifyEmail: document.getElementById('notify-email').checked
            };

            // Save settings
            localStorage.setItem('alertSettings', JSON.stringify(settings));
            return settings;
        }
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire('ذخیره شد', 'تنظیمات هشدار بروزرسانی شد', 'success');
        }
    });
}

// Helper functions
function generateTimeLabels(count) {
    const labels = [];
    for (let i = count - 1; i >= 0; i--) {
        const hour = new Date(Date.now() - i * 3600000).getHours();
        labels.push(`${hour}:00`);
    }
    return labels;
}

function generateRandomData(count, min, max) {
    return Array.from({length: count}, () => Math.floor(Math.random() * (max - min + 1)) + min);
}

// Update performance chart
function updatePerformanceChart(period = '24h') {
    if (!window.charts.performance) return;

    let labels, dataPoints;

    switch(period) {
        case '1h':
            labels = generateTimeLabels(12, 5); // 5-minute intervals
            dataPoints = 12;
            break;
        case '7d':
            labels = generateTimeLabels(7 * 24);
            dataPoints = 7 * 24;
            break;
        default:
            labels = generateTimeLabels(24);
            dataPoints = 24;
    }

    window.charts.performance.data.labels = labels;
    window.charts.performance.data.datasets[0].data = generateRandomData(dataPoints, 50, 100);
    window.charts.performance.data.datasets[1].data = generateRandomData(dataPoints, 0, 20);
    window.charts.performance.update();
}

// Export functionality
function exportData() {
    Swal.fire({
        title: 'دانلود گزارش',
        text: 'گزارش سیستم در حال آماده‌سازی است...',
        icon: 'info',
        timer: 2000,
        showConfirmButton: false
    });

    setTimeout(() => {
        const data = {
            date: new Date().toLocaleDateString('fa-IR'),
            sessions: document.querySelector('#total-sessions .counter').textContent,
            activeSessions: document.querySelector('#active-sessions .counter').textContent,
            channels: document.querySelector('#total-channels .counter').textContent,
            capacity: document.querySelector('#capacity-usage .counter').textContent + '%',
            timestamp: new Date().toISOString()
        };

        const dataStr = JSON.stringify(data, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

        const link = document.createElement('a');
        link.setAttribute('href', dataUri);
        link.setAttribute('download', `dashboard_report_${Date.now()}.json`);
        link.click();
    }, 2000);
}

// Add custom styles for new components
const style = document.createElement('style');
style.textContent = `
    .activity-feed {
        max-height: 350px;
        overflow-y: auto;
    }
    
    .activity-item {
        display: flex;
        align-items: center;
        padding: 12px;
        border-bottom: 1px solid var(--border-color);
        transition: background 0.3s ease;
    }
    
    .activity-item:hover {
        background: rgba(102, 126, 234, 0.05);
    }
    
    .activity-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-left: 15px;
        font-size: 18px;
    }
    
    .activity-content {
        flex: 1;
    }
    
    .activity-text {
        font-size: 14px;
        margin-bottom: 3px;
    }
    
    .activity-time {
        font-size: 12px;
    }
    
    .heatmap-grid {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    
    .heatmap-row {
        display: flex;
        align-items: center;
        gap: 2px;
    }
    
    .heatmap-label {
        width: 80px;
        font-size: 12px;
        text-align: left;
        padding-left: 10px;
    }
    
    .heatmap-cell {
        width: 15px;
        height: 15px;
        border-radius: 3px;
        cursor: pointer;
        transition: transform 0.2s ease;
    }
    
    .heatmap-cell:hover {
        transform: scale(1.5);
        border: 1px solid #333;
    }
    
    .optimization-suggestions {
        margin-top: 20px;
    }
    
    .suggestion-item {
        padding: 15px;
        background: rgba(102, 126, 234, 0.05);
        border-radius: 10px;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
    }
    
    .suggestion-item i {
        font-size: 20px;
    }
    
    .sparkline {
        height: 40px;
        margin-top: 10px;
    }
`;
document.head.appendChild(style);