# BUFFER SCHEDULING — Quick Start
# 1. Set your token: $env:BUFFER_ACCESS_TOKEN = "1/xxx..."
#    Get it from: https://buffer.com/developers/api
# 2. Run: powershell -File buffer-schedule.ps1

$BUFFER_TOKEN = $env:BUFFER_ACCESS_TOKEN
if (-not $BUFFER_TOKEN) {
    Write-Host "ERROR: Set BUFFER_ACCESS_TOKEN env var" -ForegroundColor Red
    Write-Host "  `$env:BUFFER_ACCESS_TOKEN = '1/xxx...'" -ForegroundColor Yellow
    exit 1
}

$BASE = "https://api.bufferapp.com/1"
Write-Host "`n📋 Fetching profiles..." -ForegroundColor Cyan
$profiles = Invoke-RestMethod -Uri "$BASE/profiles.json?access_token=$BUFFER_TOKEN"
$profiles | % { Write-Host "  [$($_.service)] $($_.formatted_username) — id: $($_.id)" }

$twitterId  = ($profiles | ? { $_.service -eq 'twitter' } | Select -First 1).id
$linkedinId = ($profiles | ? { $_.service -eq 'linkedin' } | Select -First 1).id

function Send-Buffer($pid, $text, [datetime]$at) {
    try {
        $r = Invoke-RestMethod "$BASE/updates/create.json" -Method Post -Body @{
            access_token = $BUFFER_TOKEN; text = $text; profile_ids = @($pid)
            scheduled_at = $at.ToString('yyyy-MM-ddTHH:mm:ssZ'); now = $false
        }
        Write-Host "  ✅ Scheduled! ID: $($r.updates[0].id)" -ForegroundColor Green
    } catch { Write-Host "  ❌ $_" -ForegroundColor Red }
}

$n = Get-Date

if ($twitterId) {
    Write-Host "`n🐦 Twitter thread..." -ForegroundColor Cyan
    Send-Buffer $twitterId "🌳 Ultrametric distance + p-adic valuation in production on @Cloudflare Workers. 451 papers, 3-phase discovery engine. Discovery through structure, not just words. https://ask.qwav.tech" ($n.AddHours(1))
    Send-Buffer $twitterId "How: 1️⃣ Word-level Levenshtein 2️⃣ Ultrametric cluster expansion 3️⃣ Tree-based search w/ strong triangle inequality pruning. `"quantm`" → discover papers w/ zero word overlap via tree structure." ($n.AddHours(3))
    Send-Buffer $twitterId "Math: d(x,z)≤max(d(x,y),d(y,z)) ultrametric · |x|_2=2^{-ord_2(x)} p-adic ranking · Ostrowski hybrid metric · Hensel lifting. @Cloudflare Workers+R2+Pages+D1. Case study: https://ultrametric-case-study.ask-qwav.pages.dev" ($n.AddHours(5))
}

if ($linkedinId) {
    Write-Host "`n💼 LinkedIn..." -ForegroundColor Cyan
    $li = "🌳 Ultrametric Tree — Practical p-Adic Information Retrieval on Cloudflare Workers`n`nWe published a case study: ultrametric distance + p-adic valuation applied to a production research paper discovery engine.`n`nThe tree organizes 451 papers via agglomerative single-linkage clustering (the only linkage that guarantees ultrametric distances). 3-phase engine: word-match → cluster expansion → tree pruning.`n`n20 mathematical principles with production Cloudflare applications. Ostrowski hybrid ranking, Hensel lifting layers, R2 persistence.`n`nFull case study: https://ultrametric-case-study.ask-qwav.pages.dev`nLive: https://ask.qwav.tech`nGitHub: https://github.com/rwnq8/ask-qwav`n`n#UltrametricDistance #PAdicAnalysis #CloudflareWorkers #OpenScience"
    Send-Buffer $linkedinId $li ($n.AddDays(1).Date.AddHours(10))
}

Write-Host "`n✅ Done! Review at https://buffer.com/app" -ForegroundColor Green
