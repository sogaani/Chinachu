var program = chinachu.getProgramById(request.param.id, data.recording);
if (program === null) {
	response.setHeader('Location', request.url.replace(/\/recording\//, '/recorded/'));
	response.head(301);
	response.end();
} else {
	init();
}

function init() {

	if (!data.status.feature.streamer) return response.error(403);

	if (!program.pid) return response.error(503);

	if (program.tuner && program.tuner.isScrambling) return response.error(409);

	if (!fs.existsSync(program.recorded)) return response.error(410);

	// probing
	child_process.exec('ffprobe -v 0 -show_format -of json "' + program.recorded + '"', function (err, std) {

		if (err) {
			util.log("error", err);
			return response.error(500);
		}

		try {
			main(JSON.parse(std));
		} catch (e) {
			return response.error(500);
		}
	});
}

function main(avinfo) {

	if (request.query.debug) {
		util.log(JSON.stringify(request.headers, null, '  '));
	}

	switch (request.type) {
		case 'xspf':
			response.setHeader('content-disposition', 'attachment; filename="' + program.id + '.xspf"');
			response.head(200);

			var ext    = request.query.ext || 'm2ts';
			var prefix = request.query.prefix || '';

			var target = prefix + 'watch.' + ext  + url.parse(request.url).search;

			response.write('<?xml version="1.0" encoding="UTF-8"?>\n');
			response.write('<playlist version="1" xmlns="http://xspf.org/ns/0/">\n');
			response.write('<trackList>\n');
			response.write('<track>\n<location>' + target.replace(/&/g, '&amp;') + '</location>\n');
			response.write('<title>' + program.title + '</title>\n</track>\n');
			response.write('</trackList>\n');
			response.write('</playlist>\n');

			response.end();
			return;

		case 'm2ts':
		case 'webm':
		case 'mp4':

			util.log('[streamer] streaming: ' + program.recorded);

			var d = {
				ss   : request.query.ss     || '2', //start(seconds)
				t    : request.query.t      || null, //duration(seconds)
				s    : request.query.s      || null, //size(WxH)
				f    : request.query.f      || null, //format
				'c:v': request.query['c:v'] || null, //vcodec
				'c:a': request.query['c:a'] || null, //acodec
				'b:v': request.query['b:v'] || null, //bitrate
				'b:a': request.query['b:a'] || null, //ab
				ar   : request.query.ar     || null, //ar(Hz)
				r    : request.query.r      || null  //rate(fps)
			};

			// Caluculate Total Size
			var nsize    = parseInt(avinfo.format.size, 10);
			var lsize    = nsize / parseFloat(avinfo.format.duration) * program.seconds;

			lsize = Math.floor(lsize);

			// Ranges Support
			var range = {
				start: 0
			};

			if (request.type === 'm2ts') {
				if (request.headers.range) {
					var bytes = request.headers.range.replace(/bytes=/, '').split('-');
					var rStart = parseInt(bytes[0], 10);
					var rEnd   = parseInt(bytes[1], 10) || lsize - 2;
					if (rStart > nsize) rStart = nsize-61440;
					range.start = rStart;
					range.end = rEnd;
					response.setHeader('Content-Range', 'bytes ' + rStart + '-' + rEnd + '/' + lsize);
					response.setHeader('Content-Length', rEnd - rStart + 1);

					response.head(206);
				} else {
					response.setHeader('Accept-Ranges', 'bytes');

					response.head(200);
				}
			} else {
				response.head(200);
			}

			switch (request.type) {
				case 'm2ts':
					d.f = 'mpegts';
					d['c:v'] = d['c:v'] || 'copy';
					d['c:a'] = d['c:a'] || 'copy';
					break;
				case 'webm':
					d.f = 'webm';
					d['c:v'] = d['c:v'] || 'vp9';
					d['c:a'] = null;
					break;
			}

			var args = [];

			if (!request.query.debug) args.push('-v', '0');

			if (config.vaapiEnabled === true) {
				args.push("-vaapi_device", config.vaapiDevice || '/dev/dri/renderD128');
				args.push("-hwaccel", "vaapi");
				args.push("-hwaccel_output_format", "yuv420p");
			}

			if (d.ss) args.push('-ss', (parseInt(d.ss, 10) - 1) + '');

			args.push('-re', '-i', (!d.ss) ? 'pipe:0' : program.recorded);

			if (d.t) { args.push('-t', d.t); }

			args.push('-threads', '0');

			if (config.vaapiEnabled === true) {
				let scale = "";
				if (d.s) {
					let [width, height] = d.s.split("x");
					scale = `,scale_vaapi=w=${width}:h=${height}`;
				}
				args.push("-vf", `format=nv12|vaapi,hwupload,deinterlace_vaapi${scale}`);
				args.push("-aspect", "16:9")
			} else {
				args.push('-filter:v', 'yadif');
			}

			if (d['c:v']) {
				if (config.vaapiEnabled === true) {
					if (d['c:v'] === "mpeg2video") {
						d['c:v'] = "mpeg2_vaapi";
					}
					if (d['c:v'] === "h264") {
						d['c:v'] = "h264_vaapi";
					}
					if (d['c:v'] === "vp9") {
						d['c:v'] = "vp8_vaapi";
					}
				}
				args.push('-c:v', d['c:v']);
			}
			if (d['c:a']) args.push('-c:a', d['c:a']);

			if (d.s) {
				if (config.vaapiEnabled !== true) {
					args.push('-s', d.s);
				}
			}
			if (d.r)  args.push('-r', d.r);
			if (d.ar) args.push('-ar', d.ar);

			if (d['b:v']) {
				args.push('-b:v', d['b:v'], '-minrate:v', d['b:v'], '-maxrate:v', d['b:v']);
			}
			if (d['b:a']) {
				args.push('-b:a', d['b:a'], '-minrate:a', d['b:a'], '-maxrate:a', d['b:a']);
			}

			if (d['c:v'] === 'h264') {
				args.push('-profile:v', 'baseline');
				args.push('-preset', 'ultrafast');
				args.push('-tune', 'fastdecode,zerolatency');
			}
			if (d['c:v'] === 'h264_vaapi') {
				args.push('-profile', '77');
				args.push('-level', '41');
			}
			if (d['c:v'] === 'vp9') {
				args.push('-deadline', 'realtime');
				args.push('-speed', '4');
				args.push('-cpu-used', '-8');
			}

			args.push('-y', '-f', d.f, 'pipe:1');

			if ((d['c:v'] === 'copy') && (d['c:a'] === 'copy') && (d.f === 'mpegts')) {
				var tailf = child_process.spawn('tail', ['-f', '-c', '+' + range.start, program.recorded]);
				children.push(tailf.pid);

				tailf.on('exit', function(code) {
					tailf = null;
					response.end();
				});
				request.on('close', function() {
					if (tailf) {
						tailf.stdout.removeAllListeners('data');
						tailf.stderr.removeAllListeners('data');
						tailf.kill('SIGKILL');
					}
				});
				tailf.stdout.pipe(response);
			} else {
				var ffmpeg = child_process.spawn('ffmpeg', args);
				children.push(ffmpeg.pid);
				util.log('SPAWN: ffmpeg ' + args.join(' ') + ' (pid=' + ffmpeg.pid + ')');

				var tailf = child_process.spawn('tail', ['-f', program.recorded]);
				children.push(tailf.pid);

				tailf.stdout.pipe(ffmpeg.stdin);

				tailf.on('exit', function(code) {
					if (ffmpeg) ffmpeg.kill('SIGKILL');
					tailf = null;
				});

				ffmpeg.stdout.pipe(response);

				ffmpeg.stderr.on('data', function(d) {
					util.log(d);
				});

				ffmpeg.on('exit', function(code) {
					if (tailf) {
						tailf.stdout.removeAllListeners('data');
						tailf.stderr.removeAllListeners('data');
						tailf.kill('SIGKILL');
						tailf = null;
					} else {
						ffmpeg = null;
					}

					response.end();
				});

				request.on('close', function() {
					if (tailf) {
						tailf.stdout.removeAllListeners('data');
						tailf.stderr.removeAllListeners('data');
						tailf.kill('SIGKILL');
					} else {
						ffmpeg.stdout.removeAllListeners('data');
						ffmpeg.stderr.removeAllListeners('data');
						ffmpeg.kill('SIGKILL');
						ffmpeg = null;
					}
				});
			}

			return;
	}//<--switch

}
