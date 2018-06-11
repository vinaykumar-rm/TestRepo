// FunctionName: azure-create-binary-stream-metadata
// Purpose: When a file is uploaded to an RDP media asset bucket for a tenant, the bucket should trigger this function. It Will create
//          binary stream object that contains the metadata of the file. It will invoke a REST API call on RDP API Server.
// Version: 1.0
// Last update: Mar-12-2018, Support for azure blob storage

'use strict';

var isDebugEnabled = false;
var http = require('http');

const TASK_ID_METADATA_PROPERTY = 'x-rdp-taskid';
const RDP_ESCAPING_PREFIX = 'x_rdp_';
const RDP_PREFIX = 'x-rdp-';

module.exports = function (context, storageBlob) {
    
    if (process.env.ENV_IS_DEBUG_ENABLED && process.env.ENV_IS_DEBUG_ENABLED.toLowerCase() == 'true') {
        isDebugEnabled = true;
    }

    // Lets log the recieved blob event
    if (isDebugEnabled) {
        context.log.info("Processing blob path :", context.bindingData.blobTrigger, ", Blob Size:", storageBlob.length, "Bytes");
        context.log.verbose("Blob details:", JSON.stringify(context.bindingData, null, 2));
    }

    // Get the env configuration
    var envConfig = getEnvironmentConfiguration( context );
    if (envConfig) {
        if (isDebugEnabled) {
            context.log.verbose('Environment configuration: ', JSON.stringify(envConfig, null, 2));
        }
        var blobMetadata = getBlobMetadata(context);
        var containerMetadata = blobMetadata;
        //getContainerMetadata(context);
        var headers = createRequestHeaders(envConfig, blobMetadata, containerMetadata);
        var binaryStreamObject = buildBinaryStreamObject(context, headers, blobMetadata, containerMetadata);
        postBinaryStreamObject(context, envConfig, headers, binaryStreamObject);
    } else {
        context.done("Unable to initialize environment configuration");
    }
};


var getBlobMetadata = function (context) {
    var blobMetadata = {};
    for(var metadataKey in context.bindingData.metadata) {
        var metadataValue = context.bindingData.metadata[metadataKey];
        blobMetadata[metadataKey.replace(RDP_ESCAPING_PREFIX, RDP_PREFIX)] = metadataValue;
    }   
    return blobMetadata;
};


var getContainerMetadata = function (context) {
    return context.bindingData.metadata;
};

var postBinaryStreamObject = function (context, envConfig, headers, binaryStreamObject) {
    
    var options = getHttpRequestOptions(envConfig, headers);
    if (isDebugEnabled) {
        context.log.verbose('BinaryStreamObject: ', JSON.stringify(binaryStreamObject, null, 2));
        context.log.verbose('Http request options: ', JSON.stringify(options, null, 2));
    }

    var responseBody = '';
    // Prepare the post request 
    var req = http.request(options, function (res) {
        if (isDebugEnabled) {
            context.log.verbose('Status: ' + res.statusCode);
            context.log.verbose('Headers: ' + JSON.stringify(res.headers));
        }

        // Handle on recieving data, which we should ingore
        res.on('data', function (chunk) {
            responseBody += chunk;
        });

        // On Error
        res.on('error', function (e) {
            context.log.error("Error while calling REST API: " + e);
            context.done("Error while calling REST API: " + e);
        });

        var taskId = binaryStreamObject.clientAttributes.taskId.values[0].value;

        // On end
        res.on('end', function () {
            var isSuccessfull = false;
            if (res.statusCode == 200 && responseBody) {
                const responseMessage = `Using taskId ${taskId}, RDP API Response: ${responseBody}`;
                context.log(responseMessage);
                var responseJson = JSON.parse(responseBody);
                if (responseJson && responseJson.response && responseJson.response.status && responseJson.response.status.toLowerCase() == 'success') {
                    isSuccessfull = true;
                }
            }

            if (isSuccessfull) {
                context.done();
            } else {
                const errorMsg = "Fail to make REST api call to post the binary stream object.";
                context.log.error(errorMsg);
                context.done(errorMsg);
            }
        });
    });

    req.write(JSON.stringify(binaryStreamObject));
    req.end();
};

var buildBinaryStreamObject = function (context, headers, blobMetadata, containerMetadata) {
    // The object key for the blob
    var blobObjectKey = context.bindingData.name;

    if (isDebugEnabled) {
        context.log.verbose("Blob metadata: ", JSON.stringify(blobMetadata, null, 2));
        context.log.verbose("Container metadata: ", JSON.stringify(containerMetadata, null, 2));
    }

    // We will attempt to get the object id used for binary stream object from the metadata
    // If it does not exists, we will use the invocation id
    var assignedObjectId = blobMetadata.binarystreamobjectid ? blobMetadata.binarystreamobjectid : context.bindingData.invocationId;

    // Look for the original file name in the metadata
    // if not found we will use the blob key ( removing any parent folders in case it was delimited by path)
    var assignedOriginalFileName = blobMetadata.originalfilename ? blobMetadata.originalfilename : blobObjectKey.split('/').pop();

        // Assign taskId based on the object tag if exists otherwise use the invocation id
        var taskId = context.bindingData.invocationId;
        if(blobMetadata && blobMetadata.TASK_ID_METADATA_PROPERTY) {
            taskId = blobMetadata.TASK_ID_METADATA_PROPERTY; 
        }
        
    var binaryStreamObject = {
        'clientAttributes': {
            'taskId': {
                'values': [
                    {
                        'locale': 'en-US',
                        'source': 'internal',
                        'value': taskId
                    }    
                ]
            }
        },
        'binaryStreamObject': {
            'id': assignedObjectId,
            'type': 'binarystreamobject',
            'properties': {
                'objectKey': blobObjectKey,
                'originalFileName': assignedOriginalFileName,
                'fullObjectPath': blobObjectKey,
                'contentSize': context.bindingData.properties.length,
                'user': headers['x-rdp-userId'],
                'role': headers['x-rdp-userRoles'],
                'ownershipData': headers['x-rdp-ownershipData']
            }
        }
    };   
    
    return binaryStreamObject;    
}
    
var getHttpRequestOptions = function (envConfig, headers) {
    var options = {
        'protocol': 'http:',
        'host': envConfig.rdpHost,
        'port': envConfig.rdpPort,
        'path': '/' + headers['x-rdp-tenantId'] + '/api/binarystreamobjectservice/create',
        'method': 'POST',
        headers
    };
    return options;
};


var getEnvironmentConfiguration = function (context) {

    if (!process.env.ENV_RDP_HOST) {
        const errorMsg = "Unable to locate environment variable ENV_RDP_HOST";
        context.log.error(errorMsg);
        context.done(errorMsg);
        return null;
    }

    if (!process.env.ENV_RDP_PORT) {
        const errorMsg = "Unable to locate environment variable ENV_RDP_PORT";
        context.log.error(errorMsg);
        context.done(errorMsg);
        return null;
    }

    if (!process.env.ENV_CLIENT_ID) {
        const errorMsg = "Unable to locate environment variable ENV_CLIENT_ID";
        context.log.error(errorMsg);
        context.done(errorMsg);
        return null;
    }

    if (!process.env.ENV_DEFAULT_OWNERSHIPDATA) {
        const errorMsg = "Unable to locate environment variable ENV_DEFAULT_OWNERSHIPDATA";
        context.log.error(errorMsg);
        context.done(errorMsg);
        return null;
    }

    if (!process.env.ENV_DEFAULT_TENANT_ID) {
        const errorMsg = "Unable to locate environment variable ENV_DEFAULT_TENANT_ID";
        context.log.error(errorMsg);
        context.done(errorMsg);
        return null;
    }

    if (!process.env.ENV_DEFAULT_USER_ID) {
        const errorMsg = "Unable to locate environment variable ENV_DEFAULT_USER_ID";
        context.log.error(errorMsg);
        context.done(errorMsg);
        return null;
    }

    if (!process.env.ENV_DEFAULT_USER_ROLES) {
        const errorMsg = "Unable to locate environment variable ENV_DEFAULT_USER_ROLES";
        context.log.error(errorMsg);
        context.done(errorMsg);
        return null;
    }

    // Get all the env variables
    var envConfig = {
        'rdpHost': process.env.ENV_RDP_HOST,
        'rdpPort': process.env.ENV_RDP_PORT,
        'defaultClientId': process.env.ENV_CLIENT_ID,
        'defaultOwnershipData': process.env.ENV_DEFAULT_OWNERSHIPDATA,
        'defaultTenantId': process.env.ENV_DEFAULT_TENANT_ID,
        'defaultUserId': process.env.ENV_DEFAULT_USER_ID,
        'defaultUserRoles': process.env.ENV_DEFAULT_USER_ROLES
    };
    return envConfig;
};

var createRequestHeaders = function (envConfig, blobMetadata, containerMetadata) {

    var tenantId = getPropertyValueFromMetadata(envConfig, blobMetadata, containerMetadata, 'x-rdp-tenantid', envConfig.defaultTenantId);
    var clientId = getPropertyValueFromMetadata(envConfig, blobMetadata, containerMetadata, 'x-rdp-clientid', envConfig.defaultClientId);
    
    var headers = {
        'Content-Type': 'application/json',
        'x-rdp-version': '8.1',
        'x-rdp-clientId': clientId,
        'x-rdp-ownershipData': blobMetadata['x-rdp-ownershipdata'] ? blobMetadata['x-rdp-ownershipdata'] : envConfig.defaultOwnershipData,
        'x-rdp-tenantId': tenantId,
        'x-rdp-userId': blobMetadata['x-rdp-userid'] ? blobMetadata['x-rdp-userid'] : envConfig.defaultUserId,        
        'x-rdp-userRoles': blobMetadata['x-rdp-userroles'] ? blobMetadata['x-rdp-userroles'] : envConfig.defaultUserRoles
    };
    return headers;
};

// Extract the metadata properties from blob and if not exists from container
var getPropertyValueFromMetadata = function(envConfig, blobMetadata, containerMetadata, propertyName, defaultValue) {
    var propertyValue = defaultValue;
    if(blobMetadata && blobMetadata[propertyName]) {
        propertyValue = blobMetadata[propertyName];
    } else if(containerMetadata && containerMetadata[propertyName]) {
        propertyValue = containerMetadata[propertyName];
    }
    return propertyValue;
};
