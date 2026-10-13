/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2025 Fernando Rijo Cedeno
 */

const crypto = require('node:crypto');

const RESOURCE_TYPES = {
  'cicsmanagedregion': 'CICSManagedRegion',
  'cicscicsplex': 'CICSCICSPlex',
  'cicsregion': 'CICSRegion',
  'cicsdefinitionprogram': 'CICSDefinitionProgram',
  'cicsdefinitiontransaction': 'CICSDefinitionTransaction',
  'cicsdefinitionurimap': 'CICSDefinitionURIMap',
  'cicsdefinitionwebservice': 'CICSDefinitionWebService',
  'cicsdefinitionbundle': 'CICSDefinitionBundle',
  'cicsprogram': 'CICSProgram',
  'cicslibrary': 'CICSLibrary',
  'cicstcpipservice': 'CICSTCPIPService',
  'cicspipeline': 'CICSPipeline',
  'cicswebservice': 'CICSWebService',
  'cicsjvmserver': 'CICSJVMServer',
  'cicsjvmendpoint': 'CICSJVMEndpoint',
  'cicsurimap': 'CICSURIMap',
  'cicsregiongroup': 'CICSRegionGroup',
  'cicscsdgroup': 'CICSCSDGroup',
  'cicscsdgroupinlist': 'CICSCSDGroupInList',
  'cicsresultcache': 'CICSResultCache',
  'cicstask': 'CICSTask',
  'cicsbundle': 'CICSBundle',
  'cicsbundlepart': 'CICSBundlePart',
  'cicslocalfile': 'CICSLocalFile',
  'cicsremotefile': 'CICSRemoteFile',
  'cicslocaltransaction': 'CICSLocalTransaction',
  'cicsremotetransaction': 'CICSRemoteTransaction',
  'cicstsqueue': 'CICSTSQueue',
  'cicssharedtsqueue': 'CICSSharedTSQueue'
};

// Stable identities make fixtures and pagination assertions reproducible.
function keyData(resourceType, index, length = 16) {
  return crypto.createHash('sha256').update(`${resourceType}:${index}`).digest('hex').slice(0, length).toUpperCase();
}

function generateMockData(resourceType, count = 1) {
  const mockData = [];

  for (let i = 0; i < count; i++) {
    let record;

    switch (resourceType) {
      case 'cicsmanagedregion':
        record = {
          $: {
            _keydata: keyData(resourceType, i),
            actvtime: '',
            ainsfail: 'CONTINUE',
            applid: `REGION${i + 1}`,
            autoinst: 'NEVER',
            bastrace: '00000000',
            botrsupd: '1',
            chetrace: '00000000',
            cicsname: `REGION${i + 1}`,
            cicssamp: '0',
            cicsstate: 'ACTIVE',
            cmasname: 'MYCMAS',
            comtrace: '00000000',
            connsamp: '0',
            cpsmver: '0620',
            dattrace: '00000000',
            daylghtsv: 'NO',
            dbxsamp: '0',
            desc: `Mock region ${i + 1}`,
            filesamp: '0',
            glblsamp: '0',
            host: '',
            jrnlsamp: '0',
            knltrace: '00000000',
            mastrace: '00000000',
            mastype: 'LOCAL',
            monstatus: 'NO',
            msgtrace: '00000000',
            mxtaction: '',
            mxtsev: 'HS',
            networkid: '',
            nrmaction: '',
            nrmsev: 'N_A',
            port: '',
            pricmas: '',
            progsamp: '0',
            quetrace: '00000000',
            readrs: '200',
            retention: '0',
            rtastatus: 'SAM',
            rtatrace: '00000000',
            samaction: '',
            samsev: 'VHS',
            sdmaction: '',
            sdmsev: 'VHS',
            secbypass: 'NO',
            seccmdchk: 'NO',
            secreschk: 'NO',
            sosaction: '',
            sossev: 'HS',
            srvtrace: '00000000',
            stlaction: '',
            stlsev: 'VHS',
            tdmaction: '',
            tdmsev: 'HW',
            tdqsamp: '0',
            termsamp: '0',
            tmezone: 'Z'
          }
        };
        break;

      case 'cicscicsplex':
        record = {
          $: {
            _keydata: keyData(resourceType, i, 32),
            accesstype: 'LOCAL',
            botrsupd: '1',
            cmasname: 'REGION1',
            mpstatus: 'YES',
            plexname: `PLEX${i + 1}`,
            readrs: '200',
            rspoolid: 'DFHRSTAT',
            status: 'ACTIVE',
            sysid: 'EPCM',
            toprsupd: '5',
            transitcmas: '',
            transitcnt: '0',
            updaters: '15'
          }
        };
        break;

      case 'cicsprogram':
      case 'cicsdefinitionprogram':
        record = {
          $: {
            _keydata: keyData(resourceType, i),
            program: `PROG${String(i + 1).padStart(3, '0')}`,
            language: 'COBOL',
            length: '12345',
            reload: 'NO',
            resident: 'NO',
            status: 'ENABLED',
            usage: 'NORMAL',
            uselpacopy: 'NO'
          }
        };
        break;

      case 'cicsremotefile':
        record = {
          $: {
            _keydata: keyData(resourceType, i),
            eyu_cicsname: 'REGION1',
            eyu_cicsrel: 'E740',
            file: `REM${String(i + 1).padStart(5, '0')}`,
            enablestatus: 'ENABLED',
            remotename: `LOC${String(i + 1).padStart(5, '0')}`,
            remotesystem: 'REG1',
            keylength: '8',
            addcnt: '0',
            browsecnt: '0',
            getcnt: '0',
            getupdcnt: '0',
            remdelcnt: '0',
            updatecnt: '0'
          }
        };
        break;

      case 'cicsjvmendpoint':
        record = {
          $: {
            _keydata: keyData(resourceType, i),
            eyu_cicsname: 'REGION1',
            eyu_cicsrel: 'E740',
            jvmendpoint: `httpEndpoint${String(i + 1).padStart(5, '0')}`,
            jvmserver: 'JVM00001',
            enablestatus: 'ENABLED',
            host: '127.0.0.1',
            port: '9080',
            secport: '9443',
            type: 'com.ibm.ws.http'
          }
        };
        break;

      case 'cicstsqueue':
      case 'cicssharedtsqueue': {
        const shared = resourceType === 'cicssharedtsqueue';
        const suffix = String(i + 1).padStart(5, '0');
        // HEXNAME contains the 16-byte, space-padded EBCDIC queue name.
        const hexPrefix = shared ? 'E2C8D9E3E2D8' : 'E3E2D8';
        const hexSuffix = suffix.replace(/\d/g, digit => `F${digit}`);
        record = {
          $: {
            _keydata: keyData(resourceType, i),
            eyu_cicsname: 'REGION1',
            eyu_cicsrel: 'E740',
            name: `${shared ? 'SHRTSQ' : 'TSQ'}${suffix}`,
            hexname: `${hexPrefix}${hexSuffix}`.padEnd(32, '40'),
            location: shared ? 'AUXILIARY' : 'MAIN',
            numitems: '3',
            quelength: '240',
            minitemlen: '80',
            maxitemlen: '80',
            recovstatus: 'NOTRECOVABLE',
            expiryint: '0',
            expiryintmin: '0',
            lastusedint: '0',
            ...(shared ? { poolname: 'POOL1' } : { transid: 'TRN1', tsmodel: 'TSMODEL1' })
          }
        };
        break;
      }

      default:
        record = {
          $: {
            _keydata: keyData(resourceType, i),
            name: `${resourceType.toUpperCase()}${i + 1}`,
            status: 'ACTIVE'
          }
        };
    }

    mockData.push(record);
  }

  return mockData;
}

module.exports = { RESOURCE_TYPES: Object.freeze(RESOURCE_TYPES), generateMockData, keyData };
