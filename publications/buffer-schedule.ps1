# Buffer Social Media Scheduler — Now via Cloudflare Worker (token stays secret!)
# Setup (one-time):
#   1. npx wrangler secret put BUFFER_ACCESS_TOKEN
#      Enter: 1/xxx... (your Buffer access token from https://buffer.com/developers/api)
#   2. npx wrangler deploy
# Schedule:
#   3. curl -X POST https://ask-qwav.q08.workers.dev/buffer-schedule
#      OR run this script

Write-Output "Scheduling social media posts via Cloudflare Worker..."

try {
    $response = Invoke-RestMethod -Method POST `
        -Uri "https://ask-qwav.q08.workers.dev/buffer-schedule" `
        -TimeoutSec 15
    Write-Output "✅ Scheduled $($response.scheduled) posts:"
    foreach ($r in $response.results) {
        Write-Output "   - success=$($r.success) id=$($r.id) scheduled_at=$($r.scheduled_at)"
    }
} catch {
    Write-Output "❌ Error: $_"
    Write-Output ""
    Write-Output "If you see 'BUFFER_ACCESS_TOKEN not configured', run:"
    Write-Output "  npx wrangler secret put BUFFER_ACCESS_TOKEN"
    Write-Output "Then enter your Buffer access token from https://buffer.com/developers/api"
}
