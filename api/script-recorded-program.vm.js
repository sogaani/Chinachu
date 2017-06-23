(function() {

	var program = chinachu.getProgramById(request.param.id, data.recorded);

	if (program === null) return response.error(404);

	program.isRemoved = !fs.existsSync(program.recorded);

	switch (request.method) {
		case 'GET':
			response.head(200);
			response.end(JSON.stringify(program, null, '  '));
			return;

		case 'DELETE':
			if (fs.existsSync(program.recorded)) {
				fs.unlinkSync(program.recorded);
			}

			data.recorded = (function() {
				var array = [];

				data.recorded.forEach(function(a) {
					if (a.id !== program.id) {
						array.push(a);
					}
				});

				return array;
			})();

			fs.writeFileSync(define.RECORDED_DATA_FILE, JSON.stringify(data.recorded));

			response.head(200);
			response.end('{}');
			return;

		case 'PUT':
			if (!request.query.json) return response.error(400);

			var obj = {};

			try {
				obj = JSON.parse(request.query.json);
			} catch (e) {
				return response.error(400);
			}

			data.recorded = (function() {
				var array = [];

				data.recorded.forEach(function(a) {
					if (a.id !== program.id) {
						array.push(a);
					} else {
						for (var i in obj) {
							if ( i in a ){
								a[i] = obj[i];
							}
						}
						array.push(a);
					}
				});

				return array;
			})();
			fs.writeFileSync(define.RECORDED_DATA_FILE, JSON.stringify(data.recorded));

			response.head(200);
			response.end('{}');
			return;
	}

})();