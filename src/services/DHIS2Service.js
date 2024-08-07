require('dotenv').config();
const request = require('requestretry');
const winston = require('winston');
const MFRService = require('./MFRService');
const queue = require('./QueueService');
const axios = require('axios');
const { remapMfrToDhis } = require('../utils/utils');
const options = {
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  auth: {
    username: process.env.DHIS2_USER,
    password: process.env.DHIS2_PASSWORD,
  },
  json: true,
  maxAttempts: 10,
  retryDelay: 5000,
  retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
};

class DHIS2Service {
  sendSingleOrgUnit = async (dhis2Object, updateIfExist = false) => {
    winston.info('Processing DHIS2 Object', { name: dhis2Object.name, reportsTo: dhis2Object.reportsTo.name });
    console.log(dhis2Object.name)
    let locationOrg = await this._getDHIS2OrgUnit(dhis2Object.dhisId);

    if (!locationOrg) {
      locationOrg = await this._findOrgUnitByCode(dhis2Object.facilityId);
    }

    if (!locationOrg) {
      const orgUnitId = await this._getFacilityParent(dhis2Object);

      if (!orgUnitId) {
        winston.info('No orgunit found for location', { facilityId: dhis2Object.facilityId });
        return;
      }

      if (dhis2Object.isPrimaryHealthCareUnit && !this._isOfficeOrZonalHealthDept(dhis2Object.type)) {
        const phcuResponse = await this._createPHCU(dhis2Object, orgUnitId);
        if (phcuResponse) {
          orgUnitId = phcuResponse.response.uid;
        }
      }

      const createResponse = await this._createOrgUnit(dhis2Object, orgUnitId);
      if (createResponse) {
        winston.info('Created new Org Unit', { orgUnitId: createResponse.response.uid });
        return {
          orgUnitId: createResponse.response.uid,
          parentOrgUnitId: orgUnitId,
          ...dhis2Object,
        };
      }
    } else {
      if (updateIfExist) {
        const updateResponse = await this._updateExistingOrgUnit(dhis2Object, locationOrg);
        if (updateResponse) {
          winston.info('Updated existing Org Unit', { orgUnitId: updateResponse.orgUnitId });
        }
        return updateResponse;
      }
      return {
        orgUnitId: locationOrg.id,
        ...dhis2Object,
      };
    }
  };

  sendOrgUnit = async (dhis2Objects, payload = null) => {
    const failedQueue = queue.failedQueue;
    const responseBody = [];

    winston.info('Preparing facilities to send to DHIS2', { count: dhis2Objects.length });

    for (const dhis2Object of dhis2Objects) {
      if (payload != null) payload.log(`Sending facility ${dhis2Object.name} - ${dhis2Object.id} to DHIS2`);

      const response = await this.sendSingleOrgUnit(dhis2Object, true);

      if (!response) {
        winston.error('Failed to send facility', { id: dhis2Object.id });
        failedQueue.add({ id: dhis2Object.id });
      } else {
        winston.info('Successfully sent facility', { id: dhis2Object.id });
        responseBody.push(response);
      }
    }

    return responseBody;
  };

 




saveFacilityToDataStore = async function (mfrFacility) {
    let dataStoreValue = null;
    try {
      dataStoreValue = await axios.get(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, {
        auth: {
          username: process.env.DHIS2_USER,
          password: process.env.DHIS2_PASSWORD
        }
      });
    } catch (e) {
      // Do nothing 
    }
  
    const remappedFacility = remapMfrToDhis(mfrFacility);
    
    try {
      
      if (dataStoreValue && dataStoreValue.data["resource.meta.lastUpdated"] === mfrFacility.resource.meta.lastUpdated) {
        console.log(`Facility with MFR ID ${mfrFacility.resource.id} already exists in the datastore. No update needed`);
      } else if (dataStoreValue) {
        await axios.put(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remappedFacility, {
          auth: {
            username: process.env.DHIS2_USER,
            password: process.env.DHIS2_PASSWORD
          }
        });
        console.log(`Facility with MFR ID ${mfrFacility.resource.id} updated in the datastore.`);
      } else {
        await axios.post(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remappedFacility, {
          auth: {
            username: process.env.DHIS2_USER,
            password: process.env.DHIS2_PASSWORD
          }
        });
        console.log(`Facility with MFR ID ${mfrFacility.resource.id} created in the datastore.`);
      }
    } catch (error) {
      winston.error(`Error saving facility ${mfrFacility.resource.id} to datastore: ${error.message}`);
    }
  };

  

}

module.exports = DHIS2Service;
