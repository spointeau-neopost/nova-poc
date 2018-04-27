/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var express = require('express'); // app server
var bodyParser = require('body-parser'); // parser for post requests
var watson = require('watson-developer-cloud'); // watson sdk
var mysql = require ('mysql');
var Promise = require("bluebird");
var geolib = require('geolib');
var axios = require('axios');

var fs = require('fs');
var path = require('path');
var NodeGeocoder = require('node-geocoder');

var options = {
	provider: 'openstreetmap',
 
	// Optional depending on the providers
	httpAdapter: 'https', // Default
	formatter: null         // 'gpx', 'string', ...
};
 
var geocoder = NodeGeocoder(options);

// Connection to Packcity database in DEV
var config = {
	host: 		"10.70.8.6",			// devx0001
	user: 		"niss",
	password: 	"Portalniss",
	database: 	"niss_om_packcity"
};

/*var con = mysql.createConnection({
  host: 		"10.70.8.6",			// devx0001
  user: 		"niss",
  password: 	"Portalniss",
  database: 	"niss_om_packcity"
});

con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
});*/

class Database {
    constructor( config ) {
        this.connection = mysql.createConnection( config );
    }
    query( sql, args ) {
        return new Promise( ( resolve, reject ) => {
            this.connection.query( sql, args, ( err, rows ) => {
                if ( err )
                    return reject( err );
                resolve( rows );
            } );
        } );
    }
    close() {
        return new Promise( ( resolve, reject ) => {
            this.connection.end( err => {
                if ( err )
                    return reject( err );
                resolve();
            } );
        } );
    }
}

var database = new Database( config );
var app = express();
var position = {};

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());

// Create the service wrapper

var assistant = new watson.AssistantV1({
  // If unspecified here, the ASSISTANT_USERNAME and ASSISTANT_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  username: process.env.ASSISTANT_USERNAME || '<username>',
  password: process.env.ASSISTANT_PASSWORD || '<password>',
  version: '2018-02-16'
});

// Endpoint to be call from the client side
app.post('/api/message', function(req, res) {
	var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
	if (!workspace || workspace === '<workspace-id>') {
		return res.json({
			'output': {
				'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' + '<a href="https://github.com/watson-developer-cloud/assistant-simple">README</a> documentation on how to set this variable. <br>' + 'Once a workspace has been defined the intents may be imported from ' + '<a href="https://github.com/watson-developer-cloud/assistant-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
			}
		});
	}
  
	var newcontext = req.body.context || {};
	var newmetadata = {'deployment':'NovaPoc-1'};
	newcontext['metadata'] = newmetadata;
  
	//console.log(req.body.context);
	//console.log(JSON.parse(req.body.input));
  
	var payload = {
		workspace_id: workspace,
		context: newcontext || {},
		input: req.body.input || {}
	};

	// Call conversation
	callconversation(payload);

	/**
	 * Send the input to the Watson Assistant service.
	 * @param payload
	 */
	function callconversation(payload) {
		const queryInput = JSON.stringify(payload.input);		
		if ( 	(payload.input.text == undefined || payload.input.text == '')		
			&& 	(payload.context.internal_action != '' && payload.context.internal_action != undefined) ) {
			payload.input = { 
				"text": payload.context.internal_action
			};
			payload.context.internal_action = '';
		}
		
		if (payload.input.text != '') {
			assistant.message(payload, function(err, data) {
				if (err) {
					return res.status(err.code || 500).json(err);
				} else {
					//console.log('assistant.message :: ', JSON.stringify(data));
					// lookup actions
					checkForLookupRequests(data, function(err, data) {
						if (err) {
							return res.status(err.code || 500).json(err);
						} else {
							return res.json(data);
						}
					});
				}
			});
		} else {
			assistant.message(payload, function(err, data) {
				if (err) {
					return res.status(err.code || 500).json(err);
				} else {
					//console.log('assistant.message :: ', JSON.stringify(data));
					return res.json(data);
				}
			});
		}
	}
});

/**
*
* Looks for actions requested by Watson Assistant service and provides the requested data.
*
**/
function checkForLookupRequests(data, callback) {
	if(data.output.action) {
		var action = data.output.action;
		if (action.name === "search_parcel") {
			checkForParcelTV2(data, action, function(err, response) {
				if (err) {
					console.log('Error while calling account services for parcel', err);
					callback(err, null);
				} else {
					if(response !== "") {
						if (data.output.text) {
							data.output.text.push(response);
						}
					}
				}
				callback(null, data);
			});
		} else if (action.name === "search_promo") {
			checkPromotion(data, action, function(err, response) {
				if (err) {
					console.log('Error while calling account services for promotion', err);
					callback(err, null);
				} else {
					if(response !== "") {
						if (data.output.text) {
							data.output.text.unshift(response);
						}
					}
				}
				callback(null, data);
			});
		} else if (action.name === "search_locker") {
			checkForLockerTV2(data, action, function(err, response) {
				if (err) {
					console.log('Error while calling account services for locker', err);
					callback(err, null);
				} else {
					if(response !== "") {
						if (data.output.text) {
							data.output.text.push(response);
						}
					}
				}
				callback(null, data);
			});
		} else if (action.name === "dummy") {
			if (data.output.text) {
				data.output.text.push("I can add DUMMY text to the response.");
			}
			callback(null, data);
		}
	} else {
		callback(null, data);
		return;
	}
}

function checkPromotion(data, action, callback) {
	var parameters = action.parameters;
	var filePath = './data/promo/';
	var responseText = '';
	fs.readdir(filePath, function(err, items) {
		if(err) {
			callback(err, null);
		} else {
			for (var i=0; i < items.length; i++) {
				// Expected file format: section_20180427_20180430_imagetests.jpg
				var fileParts = items[i].split('_');
				var section = fileParts[0]; 	// section
				var date1 = fileParts[1]; 		// start date
				var date2 = fileParts[2]; 		// end date
				var description = fileParts[3]; // description

				if( section == parameters.section ) {
					
					fs.readFile('./data/promo/' + items[i], (err, data) => {
						if(err) {
							console.log('Cannot read file ' + '"data/promo/' + items[i] + '"');
							callback(err, null);
						} else {
							//get image file extension name
							let extensionName = path.extname(`${process.cwd()}/pics/demopic.png`);

							//convert image file to base64-encoded string
							let base64Image = new Buffer(data, 'binary').toString('base64');
							
							//combine all strings
							let imgSrcString = `data:image/${extensionName.split('.').pop()};base64,${base64Image}`;							
							responseText += "<img width='100%' src='"+ imgSrcString +"'>";

							callback(null, responseText);
						}
					});
				}
			}
		}
	});
}

function checkForParcel(data, action, callback) {
	var parameters = action.parameters;
	var query = "";
	if (parameters.tracking_number && parameters.user_email) {
		query = "SELECT PL_PAR_ParcelIdentification, DATE_FORMAT(PL_PAR_LastDeliveryDate, '%d/%m/%Y %H:%i:%s') AS delivery_date, DATE_FORMAT(PL_PAR_LastCollectionDate, '%d/%m/%Y %H:%i:%s') as collection_date, PL_PAL_Identification, DATE_FORMAT(PL_PAR_ExpiryDate, '%d/%m/%Y %H:%i:%s') as expiry_date FROM PLParcel LEFT JOIN PLParcelLocker ON (PL_PAR_PAL_Id = PL_PAL_Id) WHERE PL_PAR_ParcelIdentification = '" + parameters.tracking_number + "' AND PL_PAR_RecipientEmail = '" + parameters.user_email + "';";
	}
	if (query !== "") {
		database.query( query ).then( rows => {
			var string 	= JSON.stringify(rows);
			var json 	= JSON.parse(string);
			var result 	= json[0];
			var responseText = '';
			
			if(result !== undefined) {
				responseText = 'I have found your parcel ' + result.PL_PAR_ParcelIdentification + '!</br>';
				if( result.delivery_date !== null ) {
					responseText += ' It has been delivered on ' + result.delivery_date + ' in machine ' + result.PL_PAL_Identification + '.</br>';
					if( result.collection_date !== null ) {
						responseText += ' It has been collected on ' + result.collection_date + '.';
					} else {
						responseText += ' You have until ' + result.expiry_date + ' to collect it.';
					}
				} else {
					responseText += ' It has been not been delivered yet in machine ' + result.PL_PAL_Identification + '.</br>';
				}
			} else {
				responseText = 'Sorry but I cannot find the parcel ' + parameters.tracking_number + '.';
			}
			callback(null, responseText);
		});
	} else {
		callback(null, "");
	}
}

function loginTV2(data, action, callback) {
	var url 	= process.env.TV2_LOGIN_URL || '<url>';
	var token 	= null; 

	axios.post( url, {
		"email": process.env.TV2_LOGIN || '<username>',
		"password": process.env.TV2_PASSWORD || '<password>'
	})
	.then(function(response) {
		if( response.status == 200 && response.data ) {
			token = response.data;
		}
		callback(null, token);
	})
	.catch(function(error) {
		callback(error, null);
	});
}

function checkForParcelTV2(data, action, callback) {
	var responseText = '';
	loginTV2(data, action, function(err, response) {
		var url 	= process.env.TV2_TRACKING_SHIPMENT_URL || '<url>';
		if (err) {
			console.log('Error while calling account services for login', err);
			callback(err, null);
		} else {
			var parameters = action.parameters;
			axios.defaults.headers.common['x-access-token'] = response.token;
			axios.get( url, {
				params: {
					"q": "*",
					"filters": true,
					"match_attributes.shipmentReference": parameters.tracking_number,
					"match_attributes.deliveryAddress.contact.email": parameters.user_email
				}
			})
			.then(function(response) {
				if(response.data.code == 200) {
					if(response.data.total == 0) {
						responseText += 'Sorry but I cannot find the parcel ' + parameters.tracking_number + ' associated to email ' + parameters.user_email + '.';
					} else {
						var jsonData = JSON.parse(JSON.stringify(response.data.data));
						if(response.data.total == 1) {
							var result = jsonData[0];
							responseText += 'I have found your parcel ' + result._source.attributes.shipmentReference + ' (order ' + result._source.attributes.orderReference + ') ' + result._source.attributes.deliveryAddress.contact.personCivility + ' ' + result._source.attributes.deliveryAddress.contact.personFirstName + ' ' + result._source.attributes.deliveryAddress.contact.personLastName + '.</br>';
							
							var eventDate = new Date(result._source.current.event.occurredAt);
							responseText += 'The last event received is "' + result._source.current.event.desc + '" ('+ result._source.current.event.status +') and occured on ' + eventDate.toLocaleString('fr-FR') + '.';
						} else {
							responseText += 'I have found ' + response.data.total + ' associated to that request.';
						}
					}
				}
				callback(null, responseText);
			})
			.catch(function(error) {
				console.log(error);
				callback(error, null);
			});
		}
		//callback(null, responseText);
	});
}

function checkForLockerTV2(data, action, callback) {
	const csvFilePath = 'data/PLParcelLockers.csv';
	const csv = require('csvtojson');
	var listLockers = [];
	
	var responseText = '';

	var lat = data.context.lat;
	var lng = data.context.lng;
	
	// Using callback
	geocoder.reverse({lat:lat, lon:lng}, function(err, res) {
		console.log(lat + ' -- ' + lng);
		console.log(res);
	});
	
	csv()
	.fromFile(csvFilePath)
	.on('json',(jsonObj) => {
		// combine csv header row and csv line to a json object
		// jsonObj.a ==> 1 or 4
		//console.log(jsonObj);
		if(jsonObj.PL_ADD_Latitude != null && jsonObj.PL_ADD_Longitude != null ) {
			var distance = geolib.getDistance(
				{latitude: lat, longitude: lng},
				{latitude: jsonObj.PL_ADD_Latitude, longitude: jsonObj.PL_ADD_Longitude}
			);
			listLockers.push({ 
				'name': jsonObj.PL_PAL_ShortDescription,
				'id': jsonObj.PL_PAL_Identification,
				'address1': jsonObj.PL_ADD_Address1,
				'address2': jsonObj.PL_ADD_Address2,
				'zip': jsonObj.PL_ADD_Zip,
				'city': jsonObj.PL_ADD_City,
				'latitude': jsonObj.PL_ADD_Latitude,
				'longitude': jsonObj.PL_ADD_Longitude,
				'distance': distance
			});
		}
	})
	.on('done',(error)=>{
		listLockers.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
		responseText += 'Here are the 5 closest Packcity:</br>'; 
		responseText += '<ul>';
		for (var i = 0; i < 5; i++) {
			if(listLockers[i] != undefined) {
				responseText += '<li><b>At ' + listLockers[i].distance + 'm</b>: ' + listLockers[i].name + ', ' + listLockers[i].address1 + ', ' + listLockers[i].zip + ' ' + listLockers[i].city + '</li>';
			}
		}
		responseText += '</ul>';
		callback(null, responseText);
	});
}

function checkForLocker(data, action, callback) {
	var parameters = action.parameters;
	var responseText = '';
	
	// Cavaillon
	//var lat = 43.8366045;
	//var lng = 5.0407814;
	
	// Bagneux
	var lat = 48.804757;
	var lng = 2.324413;
	
	var query = "SELECT PL_PAL_ShortDescription, PL_PAL_Identification, PL_ADD_Address1, PL_ADD_Address2, PL_ADD_Zip, PL_ADD_City, PL_ADD_Latitude, PL_ADD_Longitude FROM PLParcelLocker LEFT JOIN PLAddress ON (PL_PAL_ADD_Id = PL_ADD_Id) WHERE PL_ADD_Latitude IS NOT NULL AND PL_ADD_Longitude IS NOT NULL;";
	var listLockers = [];
	
	if (query !== "") {
		database.query( query ).then( rows => {
			var string 	= JSON.stringify(rows);
			var json 	= JSON.parse(string);
			for (var i = 0, len = json.length; i < len; i++) {
				var result 	= json[i];
				var responseText = '';
				if(result !== undefined) {
					if(result.PL_ADD_Latitude != null && result.PL_ADD_Longitude != null ) {
						var distance = geolib.getDistance(
							{latitude: lat, longitude: lng},
							{latitude: result.PL_ADD_Latitude, longitude: result.PL_ADD_Longitude}
						);
						listLockers.push({ 
							'name': result.PL_ADD_Address1,
							'address': result.PL_ADD_Address2,
							'zip': result.PL_ADD_Zip,
							'city': result.PL_ADD_City,
							'latitude': result.PL_ADD_Latitude,
							'longitude': result.PL_ADD_Longitude,
							'distance': distance
						});
					}
				} else {
					//responseText = 'Sorry but I cannot find the parcel ' + parameters.tracking_number + '.';
				}
			}
			listLockers.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
			return listLockers;
		}).then( function(result) {
			responseText += 'Here are the 5 closest Packcity:</br>'; 
			responseText += '<ul>';
			for (var i = 0; i < 5; i++) {
				if(result[i] != undefined) {
					responseText += '<li><b>At ' + result[i].distance + 'm</b>: ' + result[i].name + ', ' + result[i].address + ', ' + result[i].zip + ' ' + result[i].city + '</li>';
				}
			}
			responseText += '</ul>';
			callback(null, responseText);
		});
	} else {
		callback(null, "");
	}
}

module.exports = app;
