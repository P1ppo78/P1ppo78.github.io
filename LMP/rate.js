    // =================================================================
    // LIKHTAR QUALITY MARKS (PARSING JACRED + UAFLIX)
    // =================================================================
    function initMarksJacRed() {
        var _jacredCache = {};
        var _uafixCache = {};

        function fetchWithProxy(url, callback) {
            var proxies = [
                'https://api.allorigins.win/get?url=',
                'https://cors-anywhere.herokuapp.com/',
                'https://thingproxy.freeboard.io/fetch/'
            ];

            function tryProxy(index) {
                if (index >= proxies.length) return callback(new Error('All proxies failed'), null);

                var p = proxies[index];
                var reqUrl = p === 'https://api.allorigins.win/get?url='
                    ? p + encodeURIComponent(url)
                    : p + url;

                var xhr = new XMLHttpRequest();
                xhr.open('GET', reqUrl, true);
                if (p === 'https://cors-anywhere.herokuapp.com/') {
                    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
                }

                xhr.onload = function () {
                    if (xhr.status === 200) {
                        callback(null, xhr.responseText);
                    } else {
                        tryProxy(index + 1);
                    }
                };
                xhr.onerror = function () { tryProxy(index + 1); };
                xhr.timeout = 10000;
                xhr.ontimeout = function () { tryProxy(index + 1); };
                xhr.send();
            }
            tryProxy(0);
        }

        function getBestJacred(card, callback) {
            var cacheKey = 'jacred_v4_' + card.id;

            if (_jacredCache[cacheKey]) return callback(_jacredCache[cacheKey]);

            try {
                var raw = Lampa.Storage.get(cacheKey, '');
                if (raw && typeof raw === 'object' && raw._ts && (Date.now() - raw._ts < 48 * 60 * 60 * 1000)) {
                    _jacredCache[cacheKey] = raw;
                    return callback(raw);
                }
            } catch (e) { }

            var title = (card.original_title || card.title || card.name || '').toLowerCase();
            var year = (card.release_date || card.first_air_date || '').substr(0, 4);

            if (!title || !year) return callback(null);

            var releaseDate = new Date(card.release_date || card.first_air_date);
            if (releaseDate && releaseDate.getTime() > Date.now()) return callback(null);

            // Fetch from Jacred
            var apiUrl = 'https://jr.maxvol.pro/api/v1.0/torrents?search=' + encodeURIComponent(title) + '&year=' + year;
            fetchWithProxy(apiUrl, function (err, data) {
                if (err || !data) return callback(null);

                try {
                    var parsed;
                    try { parsed = JSON.parse(data); } catch (e) { return callback(null); }
                    if (parsed.contents) {
                        try { parsed = JSON.parse(parsed.contents); } catch (e) { }
                    }

                    var results = Array.isArray(parsed) ? parsed : (parsed.Results || []);

                    if (!results.length) {
                        var emptyData = { empty: true, _ts: Date.now() };
                        _jacredCache[cacheKey] = emptyData;
                        try { Lampa.Storage.set(cacheKey, emptyData); } catch (e) { }
                        return callback(null);
                    }

                    var bestGlobal = { resolution: 'SD', ukr: false, eng: false, hdr: false, dolbyVision: false };
                    var bestUkr = { resolution: 'SD', ukr: false, eng: false, hdr: false, dolbyVision: false };
                    var resOrder = ['SD', 'HD', 'FHD', '2K', '4K'];

                    results.forEach(function (item) {
                        var t = (item.title || '').toLowerCase();

                        var currentRes = 'SD';
                        if (t.indexOf('4k') >= 0 || t.indexOf('2160') >= 0 || t.indexOf('uhd') >= 0) currentRes = '4K';
                        else if (t.indexOf('2k') >= 0 || t.indexOf('1440') >= 0) currentRes = '2K';
                        else if (t.indexOf('1080') >= 0 || t.indexOf('fhd') >= 0 || t.indexOf('full hd') >= 0) currentRes = 'FHD';
                        else if (t.indexOf('720') >= 0 || t.indexOf('hd') >= 0) currentRes = 'HD';

                        var isUkr = false, isEng = false, isHdr = false, isDv = false;

                        if (t.indexOf('ukr') >= 0 || t.indexOf('укр') >= 0 || t.indexOf('ua') >= 0 || t.indexOf('ukrainian') >= 0) isUkr = true;
                        if (card.original_language === 'uk') isUkr = true;
                        if (t.indexOf('eng') >= 0 || t.indexOf('english') >= 0 || t.indexOf('multi') >= 0) isEng = true;

                        if (t.indexOf('dolby vision') >= 0 || t.indexOf('dolbyvision') >= 0) {
                            isHdr = true; isDv = true;
                        } else if (t.indexOf('hdr') >= 0) {
                            isHdr = true;
                        }

                        // Update global max resolution
                        if (resOrder.indexOf(currentRes) > resOrder.indexOf(bestGlobal.resolution)) {
                            bestGlobal.resolution = currentRes;
                            bestGlobal.hdr = isHdr;
                            bestGlobal.dolbyVision = isDv;
                        }
                        if (isEng) bestGlobal.eng = true;

                        // Якщо знайдено український дубляж, записуємо окремо його найкращу якість
                        if (isUkr) {
                            bestGlobal.ukr = true;
                            bestUkr.ukr = true;
                            if (resOrder.indexOf(currentRes) > resOrder.indexOf(bestUkr.resolution)) {
                                bestUkr.resolution = currentRes;
                                bestUkr.hdr = isHdr;
                                bestUkr.dolbyVision = isDv;
                            }
                            if (isEng) bestUkr.eng = true;
                        }
                    });

                    // Правило: якщо є український реліз, використовуємо показники ТІЛЬКИ з нього
                    var finalBest = bestGlobal.ukr ? bestUkr : bestGlobal;
                    if (card.original_language === 'en') finalBest.eng = true;

                    finalBest._ts = Date.now();
                    finalBest.empty = false;
                    _jacredCache[cacheKey] = finalBest;
                    try { Lampa.Storage.set(cacheKey, finalBest); } catch (e) { }
                    callback(finalBest);

                } catch (e) {
                    callback(null);
                }
            });
        }

        function checkUafixBandera(movie, callback) {
            var title = movie.title || movie.name || '';
            var origTitle = movie.original_title || movie.original_name || '';
            var imdbId = movie.imdb_id || '';
            var type = movie.name ? 'series' : 'movie';

            var url = 'https://banderabackend.lampame.v6.rocks/api/v2/search?source=uaflix';
            if (title) url += '&title=' + encodeURIComponent(title);
            if (origTitle) url += '&original_title=' + encodeURIComponent(origTitle);
            if (imdbId) url += '&imdb_id=' + encodeURIComponent(imdbId);
            url += '&type=' + type;

            var network = new Lampa.Reguest();
            network.timeout(5000);
            network.silent(url, function (json) {
                callback(json && json.ok && json.items && json.items.length > 0);
            }, function () {
                callback(null);
            });
        }

        function checkUafixDirect(movie, callback) {
            var query = movie.original_title || movie.original_name || movie.title || movie.name || '';
            if (!query) return callback(false);

            var searchUrl = 'https://uafix.net/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
            fetchWithProxy(searchUrl, function (err, html) {
                if (err || !html) return callback(false);
                var hasResults = html.indexOf('знайдено') >= 0 && html.indexOf('0 відповідей') < 0;
                callback(hasResults);
            });
        }

        function checkUafix(movie, callback) {
            if (!movie || !movie.id) return callback(false);
            var key = 'uafix_' + movie.id;
            if (_uafixCache[key] !== undefined) return callback(_uafixCache[key]);

            checkUafixBandera(movie, function (result) {
                if (result !== null) {
                    _uafixCache[key] = result;
                    callback(result);
                } else {
                    checkUafixDirect(movie, function (found) {
                        _uafixCache[key] = found;
                        callback(found);
                    });
                }
            });
        }

        function processCards() {
            $('.card:not(.jacred-mark-processed-v3)').each(function () {
                var card = $(this);
                card.addClass('jacred-mark-processed-v3');

                var movie = card[0].heroMovieData || card.data('item') || (card[0] && (card[0].card_data || card[0].item)) || null;
                if (movie && movie.id && !movie.size) {
                    if (card.hasClass('hero-banner')) {
                        addMarksToContainer(card, movie, null);
                    } else {
                        addMarksToContainer(card, movie, '.card__view');
                    }
                }
            });
        }

        function observeCardRows() {
            var observer = new MutationObserver(function () {
                processCards();
            });
            observer.observe(document.body, { childList: true, subtree: true });
            processCards();
        }

        function addMarksToContainer(element, movie, viewSelector) {
            if (!isSettingEnabled('likhtar_badge_enabled', true)) return;
            var containerParent = viewSelector ? element.find(viewSelector) : element;
            var marksContainer = containerParent.find('.card-marks');

            if (!marksContainer.length) {
                marksContainer = $('<div class="card-marks"></div>');
                containerParent.append(marksContainer);
            }

            getBestJacred(movie, function (data) {
                var bestData = data || { empty: true };

                // Якщо на Jacred немає укр доріжки, або взагалі немає релізу, шукаємо на Uaflix/UaKino
                if (!bestData.ukr) {
                    checkUafix(movie, function (hasUafix) {
                        if (hasUafix) {
                            if (bestData.empty) bestData = { empty: false, resolution: 'FHD', hdr: false };
                            bestData.ukr = true; // За правилом: якщо є на uafix, ставимо UA і 1080p
                            if (!bestData.resolution || bestData.resolution === 'SD' || bestData.resolution === 'HD') {
                                bestData.resolution = 'FHD';
                            }
                        }
                        if (!bestData.empty) renderBadges(marksContainer, bestData, movie);
                    });
                } else {
                    if (!bestData.empty) renderBadges(marksContainer, bestData, movie);
                }
            });
        }

        function createBadge(cssClass, label) {
            var badge = document.createElement('div');
            badge.classList.add('card__mark');
            badge.classList.add('card__mark--' + cssClass);
            badge.textContent = label;
            return badge;
        }

        function renderBadges(container, data, movie) {
            container.empty();
            if (!isSettingEnabled('likhtar_badge_enabled', true)) return;
            if (data.ukr && isSettingEnabled('likhtar_badge_ua', true)) container.append(createBadge('ua', 'UA'));
            if (data.eng && isSettingEnabled('likhtar_badge_en', true)) container.append(createBadge('en', 'EN'));
            if (data.resolution && data.resolution !== 'SD') {
                if (data.resolution === '4K' && isSettingEnabled('likhtar_badge_4k', true)) container.append(createBadge('4k', '4K'));
                else if (data.resolution === 'FHD' && isSettingEnabled('likhtar_badge_fhd', true)) container.append(createBadge('fhd', '1080p'));
                else if (data.resolution === 'HD' && isSettingEnabled('likhtar_badge_fhd', true)) container.append(createBadge('hd', '720p'));
                else if (isSettingEnabled('likhtar_badge_fhd', true)) container.append(createBadge('hd', data.resolution));
            }
            if (data.hdr && isSettingEnabled('likhtar_badge_hdr', true)) container.append(createBadge('hdr', 'HDR'));
            if (movie) {
                var rating = parseFloat(movie.imdb_rating || movie.kp_rating || movie.vote_average || 0);
                if (rating > 0 && String(rating) !== '0.0') {
                    var rBadge = document.createElement('div');
                    rBadge.classList.add('card__mark', 'card__mark--rating');
                    rBadge.innerHTML = '<span class="mark-star">★</span>' + rating.toFixed(1);
                    container.append(rBadge);
                }
            }
        }

        function injectFullCardMarks(movie, renderEl) {
            if (!movie || !movie.id || !renderEl) return;
            var $render = $(renderEl);

            if (isSettingEnabled('likhtar_show_logo_instead_text', true)) {
                var titleEl = $render.find('.full-start-new__title, .full-start__title').first();
                if (titleEl.length && titleEl.find('img.likhtar-full-logo').length === 0) {
                    var applyLogo = function (img_url, invert) {
                        var newHtml = '<img class="likhtar-full-logo" src="' + img_url + '" style="max-height: 4.5em; width: auto; max-width: 100%; object-fit: contain; margin-bottom: 0.2em;' + (invert ? ' filter: brightness(0) invert(1);' : '') + '">';
                        titleEl.html(newHtml);
                        titleEl.css({ fontSize: '1em', marginTop: '1.5em' });
                    };

                    if (window.LikhtarHeroLogos && window.LikhtarHeroLogos[movie.id] && window.LikhtarHeroLogos[movie.id].path) {
                        applyLogo(window.LikhtarHeroLogos[movie.id].path, window.LikhtarHeroLogos[movie.id].invert);
                    } else if (!window.LikhtarHeroLogos || !window.LikhtarHeroLogos[movie.id] || !window.LikhtarHeroLogos[movie.id].fail) {
                        var requestLang = Lampa.Storage.get('logo_lang') || Lampa.Storage.get('language', 'uk');
                        var type = movie.name ? 'tv' : 'movie';
                        var url = Lampa.TMDB.api(type + '/' + movie.id + '/images?api_key=' + getTmdbKey() + '&include_image_language=' + requestLang + ',en,null');
                        var network = new Lampa.Reguest();
                        network.silent(url, function (data) {
                            var final_logo = null;
                            if (data.logos && data.logos.length > 0) {
                                var found = data.logos.find(function (l) { return l.iso_639_1 == requestLang; }) ||
                                    data.logos.find(function (l) { return l.iso_639_1 == 'en'; }) || data.logos[0];
                                if (found) final_logo = found.file_path;
                            }
                            if (final_logo) {
                                var img_url = Lampa.TMDB.image('t/p/w500' + final_logo.replace('.svg', '.png'));
                                var img = new Image();
                                img.crossOrigin = 'Anonymous';
                                img.onload = function () {
                                    var invert = false;
                                    try {
                                        var canvas = document.createElement('canvas');
                                        var ctx = canvas.getContext('2d');
                                        canvas.width = img.naturalWidth || img.width;
                                        canvas.height = img.naturalHeight || img.height;
                                        if (canvas.width > 0 && canvas.height > 0) {
                                            ctx.drawImage(img, 0, 0);
                                            var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                                            var darkPixels = 0, totalPixels = 0;
                                            for (var i = 0; i < imgData.length; i += 4) {
                                                if (imgData[i + 3] < 10) continue;
                                                totalPixels++;
                                                if ((imgData[i] * 299 + imgData[i + 1] * 587 + imgData[i + 2] * 114) / 1000 < 120) darkPixels++;
                                            }
                                            if (totalPixels > 0 && (darkPixels / totalPixels) >= 0.85) invert = true;
                                        }
                                    } catch (e) { }
                                    window.LikhtarHeroLogos = window.LikhtarHeroLogos || {};
                                    window.LikhtarHeroLogos[movie.id] = { path: img_url, invert: invert };
                                    var currentTitleEl = $('.full-start-new__title, .full-start__title').first();
                                    if (currentTitleEl.length && currentTitleEl.find('img.likhtar-full-logo').length === 0) {
                                        var newHtml = '<img class="likhtar-full-logo" src="' + img_url + '" style="max-height: 4.5em; width: auto; max-width: 100%; object-fit: contain; margin-bottom: 0.2em;' + (invert ? ' filter: brightness(0) invert(1);' : '') + '">';
                                        currentTitleEl.html(newHtml);
                                        currentTitleEl.css({ fontSize: '1em', marginTop: '1.5em' });
                                    }
                                };
                                img.onerror = function () {
                                    window.LikhtarHeroLogos = window.LikhtarHeroLogos || {};
                                    window.LikhtarHeroLogos[movie.id] = { fail: true };
                                };
                                img.src = img_url;
                            } else {
                                window.LikhtarHeroLogos = window.LikhtarHeroLogos || {};
                                window.LikhtarHeroLogos[movie.id] = { fail: true };
                            }
                        }, function () {
                            window.LikhtarHeroLogos = window.LikhtarHeroLogos || {};
                            window.LikhtarHeroLogos[movie.id] = { fail: true };
                        });
                    }
                }
            }

            var rateLine = $render.find('.full-start-new__rate-line, .full-start__rate-line').first();
            if (!rateLine.length) return;
            if (rateLine.find('.jacred-info-marks-v3').length) return;
            var marksContainer = $('<div class="jacred-info-marks-v3"></div>');
            rateLine.prepend(marksContainer);

            getBestJacred(movie, function (data) {
                var bestData = data || { empty: true };
                if (!bestData.ukr) {
                    checkUafix(movie, function (hasUafix) {
                        if (hasUafix) {
                            if (bestData.empty) bestData = { empty: false, resolution: 'FHD', hdr: false };
                            bestData.ukr = true;
                            if (!bestData.resolution || bestData.resolution === 'SD' || bestData.resolution === 'HD') {
                                bestData.resolution = 'FHD';
                            }
                        }
                        if (!bestData.empty) renderInfoRowBadges(marksContainer, bestData);
                    });
                } else if (!bestData.empty) {
                    renderInfoRowBadges(marksContainer, bestData);
                }
            });
        }

        function initFullCardMarks() {
            if (!Lampa.Listener || !Lampa.Listener.follow) return;
            Lampa.Listener.follow('full', function (e) {
                if (e.type !== 'complite') return;
                var movie = e.data && e.data.movie;
                var renderEl = e.object && e.object.activity && e.object.activity.render && e.object.activity.render();
                injectFullCardMarks(movie, renderEl);
            });
            setTimeout(function () {
                try {
                    var act = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
                    if (!act || act.component !== 'full') return;
                    var movie = act.card || act.movie;
                    var renderEl = act.activity && act.activity.render && act.activity.render();
                    injectFullCardMarks(movie, renderEl);
                } catch (err) { }
            }, 300);
        }

        function renderInfoRowBadges(container, data) {
            container.empty();
            if (!isSettingEnabled('likhtar_badge_enabled', true)) return;
            container.addClass('jacred-info-marks-v3');
            if (data.ukr && isSettingEnabled('likhtar_badge_ua', true)) {
                var uaTag = $('<div class="likhtar-full-badge likhtar-full-badge--ua"></div>');
                uaTag.text('UA+');
                container.append(uaTag);
            }
            if (data.resolution && data.resolution !== 'SD') {
                var resText = data.resolution;
                if (resText === 'FHD') resText = '1080p';
                else if (resText === 'HD') resText = '720p';

                var showQuality = false;
                if (data.resolution === '4K' && isSettingEnabled('likhtar_badge_4k', true)) showQuality = true;
                else if ((data.resolution === 'FHD' || data.resolution === 'HD') && isSettingEnabled('likhtar_badge_fhd', true)) showQuality = true;

                if (showQuality) {
                    var qualityTag = $('<div class="likhtar-full-badge likhtar-full-badge--quality"></div>');
                    qualityTag.text(resText);
                    container.append(qualityTag);
                }
            }
            if (data.hdr && isSettingEnabled('likhtar_badge_hdr', true)) {
                var hdrTag = $('<div class="likhtar-full-badge likhtar-full-badge--hdr"></div>');
                hdrTag.text(data.dolbyVision ? 'Dolby Vision' : 'HDR');
                container.append(hdrTag);
            }
        }

        var style = document.createElement('style');
        style.innerHTML = `
            /* ====== Card marks ====== */
            .likhtar-full-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0.25em 0.5em !important;
                font-size: 0.75em !important;
                font-weight: 800 !important;
                line-height: 1 !important;
                letter-spacing: 0.05em !important;
                border-radius: 0.3em !important;
                border: 1px solid rgba(255,255,255,0.2) !important;
                box-shadow: 0 2px 6px rgba(0,0,0,0.4) !important;
                text-transform: uppercase !important;
            }
            .likhtar-full-badge--ua {
                background: linear-gradient(135deg, #1565c0, #42a5f5) !important;
                color: #fff !important;
            }
            .likhtar-full-badge--quality {
                background: linear-gradient(135deg, #2e7d32, #66bb6a) !important;
                color: #fff !important;
            }
            .likhtar-full-badge--hdr {
                background: linear-gradient(135deg, #512da8, #ab47bc) !important;
                color: #fff !important;
            }
            
            /* Native Lampa Full Movie Tags Redesign */
            #app .full-start-new .full-start-new__rate-line > div:not(.jacred-info-marks-v3),
            #app .full-start-new .full-start-new__rate-line > span:not(.jacred-info-marks-v3),
            #app .full-start__rate-line > div:not(.jacred-info-marks-v3),
            #app .full-start__rate-line > span:not(.jacred-info-marks-v3),
            .likhtar-full-badge {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 0.3em 0.6em !important;
                border-radius: 0.35em !important;
                font-weight: 800 !important;
                font-size: 0.85em !important;
                color: rgba(255,255,255,0.9) !important;
                background: linear-gradient(135deg, #37474f, #546e7a) !important;
                border: 1px solid rgba(84,110,122,0.5) !important;
                box-shadow: 0 4px 10px rgba(0,0,0,0.3) !important;
                line-height: 1.2 !important;
                letter-spacing: 0.03em !important;
                margin: 0 !important;
                height: auto !important;
                min-height: 0 !important;
            }

            #app .full-start-new .full-start-new__rate-line > .full-start__rate,
            #app .full-start__rate-line > .full-start__rate {
                background: linear-gradient(135deg, #f57f17, #fbc02d) !important;
                color: #000 !important;
                border-color: rgba(251,192,45,0.4) !important;
            }
            #app .full-start-new .full-start-new__rate-line > .full-start__pg,
            #app .full-start__rate-line > .full-start__pg {
                background: linear-gradient(135deg, #c62828, #e53935) !important;
                border-color: rgba(229,57,53,0.4) !important;
            }

            .likhtar-full-badge--ua {
                background: linear-gradient(135deg, #1565c0, #42a5f5) !important;
                color: #fff !important;
                border-color: rgba(66,165,245,0.4) !important;
            }
            .likhtar-full-badge--quality {
                background: linear-gradient(135deg, #2e7d32, #66bb6a) !important;
                color: #fff !important;
                border-color: rgba(102,187,106,0.4) !important;
            }
            .likhtar-full-badge--hdr {
                background: linear-gradient(135deg, #512da8, #ab47bc) !important;
                color: #fff !important;
                border-color: rgba(171,71,188,0.4) !important;
            }
            .full-start-new__rate-line {
                display: flex !important;
                flex-wrap: wrap !important;
                align-items: center !important;
                gap: 0.4em !important;
            }
            .jacred-info-marks-v3 {
                display: flex;
                align-items: center;
                gap: 0.4em;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                padding: 0 !important;
                margin: 0 !important;
            }

            /* Genres & runtime line */
            #app .full-start-new__info, #app .full-start__info,
            #app .full-start-new__text, #app .full-start__text {
                background: linear-gradient(135deg, #1f2235, #2c314a) !important;
                border: 1px solid rgba(44,49,74,0.5) !important;
                border-radius: 0.4em !important;
                padding: 0.4em 0.8em !important;
                display: inline-block !important;
                color: #e0e0e0 !important;
                font-size: 0.9em !important;
                letter-spacing: 0.02em !important;
                margin-top: 0.5em !important;
                backdrop-filter: blur(4px) !important;
                -webkit-backdrop-filter: blur(4px) !important;
            }

            .card .card__type { left: -0.2em !important; }
            .card-marks {
                position: absolute;
                top: 2.7em;
                left: -0.2em;
                display: flex;
                flex-direction: column;
                gap: 0.15em;
                z-index: 10;
                pointer-events: none;
            }
            .card:not(.card--tv):not(.card--movie) .card-marks,
            .card--movie .card-marks { top: 1.4em; }
            .card__mark {
                padding: 0.35em 0.45em;
                font-size: 0.8em;
                font-weight: 800;
                line-height: 1;
                letter-spacing: 0.03em;
                border-radius: 0.3em;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                align-self: flex-start;
                opacity: 0;
                animation: mark-fade-in 0.35s ease-out forwards;
                border: 1px solid rgba(255,255,255,0.15);
            }
            .card__mark--ua  { background: linear-gradient(135deg, #1565c0, #42a5f5); color: #fff; border-color: rgba(66,165,245,0.4); }
            .card__mark--4k  { background: linear-gradient(135deg, #e65100, #ff9800); color: #fff; border-color: rgba(255,152,0,0.4); }
            .card__mark--fhd { background: linear-gradient(135deg, #4a148c, #ab47bc); color: #fff; border-color: rgba(171,71,188,0.4); }
            .card__mark--hd  { background: linear-gradient(135deg, #1b5e20, #66bb6a); color: #fff; border-color: rgba(102,187,106,0.4); }
            .card__mark--en  { background: linear-gradient(135deg, #37474f, #78909c); color: #fff; border-color: rgba(120,144,156,0.4); }
            .card__mark--hdr { background: linear-gradient(135deg, #f57f17, #ffeb3b); color: #000; border-color: rgba(255,235,59,0.4); }
            .card__mark--rating { background: linear-gradient(135deg, #1a1a2e, #16213e); color: #ffd700; border-color: rgba(255,215,0,0.3); font-size: 0.75em; white-space: nowrap; }
            .card__mark--rating .mark-star { margin-right: 0.15em; font-size: 0.9em; }

            .card.jacred-mark-processed-v3 .card__vote { display: none !important; }

            .hero-banner .card-marks {
                top: 1.5em !important;
                left: 1.2em !important;
                gap: 0.3em !important;
            }
            
            .jacred-info-marks-v3 {
                display: flex; gap: 0.5em; margin-bottom: 0.8em; margin-right: 0.5em;
            }

            @keyframes mark-fade-in {
                from { opacity: 0; transform: translateX(-5px) scale(0.95); }
                to { opacity: 1; transform: translateX(0) scale(1); }
            }
        `;
        document.body.appendChild(style);

        observeCardRows();
        initFullCardMarks();

        // Global IMDB/KP badge hider — completely independent
        (function initHideImdbKp() {
            function scanAndHide() {
                var allElements = document.body.getElementsByTagName('*');
                for (var i = 0; i < allElements.length; i++) {
                    var node = allElements[i];
                    if (node.children && node.children.length > 0) continue;
                    var t = (node.textContent || '').trim();
                    if (t === 'IMDB' || t === 'KP' || t === 'imdb' || t === 'kp') {
                        node.style.setProperty('display', 'none', 'important');
                        if (node.parentElement) node.parentElement.style.setProperty('display', 'none', 'important');
                    }
                }
            }
            if (Lampa.Listener && Lampa.Listener.follow) {
                Lampa.Listener.follow('full', function (e) {
                    if (e.type === 'complite') {
                        setTimeout(scanAndHide, 200);
                        setTimeout(scanAndHide, 800);
                        setTimeout(scanAndHide, 2000);
                        setTimeout(scanAndHide, 4000);
                    }
                });
            }
            // Also run on current page if already on a full card
            setTimeout(scanAndHide, 500);
            setTimeout(scanAndHide, 1500);
            setTimeout(scanAndHide, 3000);
        })();
    }

    function runInit() {
        try {
            initMarksJacRed();
            init();
            window.LIKHTAR_STUDIOS_LOADED = true;
        } catch (err) {
            window.LIKHTAR_STUDIOS_ERROR = (err && err.message) ? err.message : String(err);
            if (typeof console !== 'undefined' && console.error) {
                console.error('[Likhtar Studios]', err);
            }
        }
    }

    if (window.appready) runInit();
    else if (typeof Lampa !== 'undefined' && Lampa.Listener && Lampa.Listener.follow) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') runInit();
        });
    } else {
        window.LIKHTAR_STUDIOS_ERROR = 'Lampa.Listener not found';
    }

})();
