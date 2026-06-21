/**
 * QNFO/QWAV Unified Analytics â v1.0
 * 
 * Single script to be included on ALL Cloudflare-hosted pages.
 * Manages: Google Analytics 4 (GA4), Google Tag Manager (GTM),
 * Cloudflare Web Analytics, and Kaizen data pipeline beacons.
 * 
 * Author: QNFO Infrastructure
 * Date: 2026-05-30
 * License: MIT
 * 
 * === USAGE ===
 * Add to <head> as the FIRST element:
 *   <script src="https://qnfo-design-system.pages.dev/js/analytics-unified.js"
 *           data-ga4-id="G-XXXXXXXXXX"
 *           data-gtm-id="GTM-XXXXXXX"
 *           data-site-name="paradigm.qnfo.org"
 *           data-site-type="paper"
 *           async></script>
 * 
 * data- attributes:
 *   data-ga4-id     â Google Analytics 4 Measurement ID (REQUIRED)
 *   data-gtm-id     â Google Tag Manager Container ID (optional)
 *   data-site-name  â Canonical domain name for this site
 *   data-site-type  â Category: paper | hub | tool | legal | archive | app
 *   data-no-ga4     â Set to "true" to disable GA4 (for legal pages, etc.)
 *   data-no-gtm     â Set to "true" to disable GTM
 */

(function() {
    'use strict';
    
    var script = document.currentScript;
    if (!script) return;
    
    // === CONFIGURATION ===
    var config = {
        ga4Id: script.getAttribute('data-ga4-id') || '',
        gtmId: script.getAttribute('data-gtm-id') || '',
        siteName: script.getAttribute('data-site-name') || window.location.hostname,
        siteType: script.getAttribute('data-site-type') || 'unknown',
        noGa4: script.getAttribute('data-no-ga4') === 'true',
        noGtm: script.getAttribute('data-no-gtm') === 'true',
        cfBeaconToken: script.getAttribute('data-cf-beacon') || '',
        kaizenEndpoint: script.getAttribute('data-kaizen-endpoint') || '',
        debug: script.getAttribute('data-debug') === 'true'
    };
    
    function log() {
        if (config.debug) {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[QNFO-Analytics]');
            console.log.apply(console, args);
        }
    }
    
    // === 1. DATA LAYER (for GTM compatibility) ===
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
        'event': 'page_view',
        'site_name': config.siteName,
        'site_type': config.siteType,
        'page_url': window.location.href,
        'page_title': document.title,
        'timestamp': new Date().toISOString(),
        'referrer': document.referrer,
        'user_agent': navigator.userAgent,
        'screen_resolution': window.screen.width + 'x' + window.screen.height
    });
    
    // === 2. GOOGLE TAG MANAGER ===
    if (config.gtmId && !config.noGtm) {
        log('Loading GTM:', config.gtmId);
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:' ';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;
        f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer',config.gtmId);
    }
    
    // === 3. GOOGLE ANALYTICS 4 ===
    if (config.ga4Id && !config.noGa4) {
        log('Loading GA4:', config.ga4Id);
        
        // GA4 base script
        var gaScript = document.createElement('script');
        gaScript.async = true;
        gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + config.ga4Id;
        document.head.appendChild(gaScript);
        
        // GA4 configuration
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        
        // Default config with custom dimensions
        gtag('config', config.ga4Id, {
            'send_page_view': true,
            'anonymize_ip': false,
            'cookie_flags': 'SameSite=None;Secure',
            'custom_map': {
                'dimension1': 'site_name',
                'dimension2': 'site_type',
                'dimension3': 'page_category'
            },
            'site_name': config.siteName,
            'site_type': config.siteType,
            'page_category': config.siteType
        });
        
        // Store gtag globally
        window.gtag = gtag;
        
        // Track outbound links
        document.addEventListener('click', function(e) {
            var target = e.target;
            while (target && target.tagName !== 'A') {
                target = target.parentNode;
            }
            if (target && target.href && target.hostname !== window.location.hostname) {
                gtag('event', 'click', {
                    'event_category': 'outbound',
                    'event_label': target.href,
                    'link_text': (target.textContent || '').trim().substring(0, 100),
                    'link_domain': target.hostname
                });
            }
        });
        
        // Track scroll depth
        var scrollDepths = {};
        var scrollHandler = function() {
            var scrollPercent = Math.round(
                (window.scrollY + window.innerHeight) / 
                document.documentElement.scrollHeight * 100
            );
            var bucket = Math.floor(scrollPercent / 25) * 25;
            if (bucket > 0 && !scrollDepths[bucket]) {
                scrollDepths[bucket] = true;
                gtag('event', 'scroll_depth', {
                    'event_category': 'engagement',
                    'event_label': bucket + '%',
                    'value': bucket,
                    'site_name': config.siteName
                });
            }
        };
        var scrollTimer;
        window.addEventListener('scroll', function() {
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(scrollHandler, 500);
        });
        
        // Track time on page
        var pageLoadTime = Date.now();
        window.addEventListener('beforeunload', function() {
            var timeOnPage = Math.round((Date.now() - pageLoadTime) / 1000);
            gtag('event', 'time_on_page', {
                'event_category': 'engagement',
                'value': timeOnPage,
                'site_name': config.siteName
            });
        });
    }
    
    // === 4. CLOUDFLARE WEB ANALYTICS BEACON ===
    if (config.cfBeaconToken) {
        log('Loading Cloudflare Web Analytics:', config.cfBeaconToken);
        var cfScript = document.createElement('script');
        cfScript.defer = true;
        cfScript.src = 'https://static.cloudflareinsights.com/beacon.min.js';
        cfScript.setAttribute('data-cf-beacon', JSON.stringify({token: config.cfBeaconToken}));
        document.head.appendChild(cfScript);
    }
    
    // === 5. KAIZEN DATA PIPELINE BEACON ===
    // Sends anonymized page metrics to QWAV infrastructure for LLM analysis
    if (config.kaizenEndpoint) {
        log('Kaizen endpoint configured:', config.kaizenEndpoint);
        var kaizenData = {
            site: config.siteName,
            type: config.siteType,
            url: window.location.href,
            title: document.title,
            referrer: document.referrer,
            screen_w: window.screen.width,
            screen_h: window.screen.height,
            viewport_w: window.innerWidth,
            viewport_h: window.innerHeight,
            timestamp: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: navigator.language
        };
        
        // Send via sendBeacon for reliability
        if (navigator.sendBeacon) {
            navigator.sendBeacon(
                config.kaizenEndpoint,
                JSON.stringify(kaizenData)
            );
        } else {
            // Fallback: fetch with keepalive
            fetch(config.kaizenEndpoint, {
                method: 'POST',
                body: JSON.stringify(kaizenData),
                keepalive: true,
                headers: {'Content-Type': 'application/json'}
            }).catch(function() {});
        }
    }
    
    // === 6. GTM NOSCRIPT FALLBACK ===
    if (config.gtmId && !config.noGtm) {
        var noscript = document.createElement('noscript');
        var iframe = document.createElement('iframe');
        iframe.src = 'https://www.googletagmanager.com/ns.html?id=' + config.gtmId;
        iframe.height = '0';
        iframe.width = '0';
        iframe.style.display = 'none';
        iframe.style.visibility = 'hidden';
        noscript.appendChild(iframe);
        document.body.insertBefore(noscript, document.body.firstChild);
    }
    
    log('Analytics initialized:', {
        ga4: !!config.ga4Id && !config.noGa4,
        gtm: !!config.gtmId && !config.noGtm,
        cf_beacon: !!config.cfBeaconToken,
        kaizen: !!config.kaizenEndpoint,
        site: config.siteName,
        type: config.siteType
    });
    
})();

