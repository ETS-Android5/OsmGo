
import { Component, AfterViewInit, OnInit, OnDestroy } from '@angular/core';

import { NavController, AlertController, Platform } from '@ionic/angular';
import { OsmApiService } from '../../services/osmApi.service';
import { TagsService } from '../../services/tags.service';
import { MapService } from '../../services/map.service';
import { DataService } from '../../services/data.service';
import { ConfigService } from '../../services/config.service';
import { timer } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { cloneDeep, clone } from 'lodash';
import { addAttributesToFeature } from '../../../../scripts/osmToOsmgo/index.js'
import { InitService } from 'src/app/services/init.service';
import { take } from 'rxjs/operators';

@Component({
    selector: 'page-push-data-to-osm',
    templateUrl: './pushDataToOsm.html',
    styleUrls: ['./pushDataToOsm.scss']
})

export class PushDataToOsmPage implements AfterViewInit, OnInit, OnDestroy {

    summary = { 'Total': 0, 'Create': 0, 'Update': 0, 'Delete': 0 };
    changesetId = '';
    commentChangeset = '';
    isPushing = false;
    featuresChanges = [];
    basicPassword = null;
    connectionError;

    constructor(
        public dataService: DataService,
        public osmApi: OsmApiService,
        public tagsService: TagsService,
        public mapService: MapService,
        public navCtrl: NavController,
        private alertCtrl: AlertController,
        public configService: ConfigService,
        public platform: Platform,
        private translate: TranslateService,
        public initService: InitService
    ) {

        this.commentChangeset = this.configService.getChangeSetComment();
        this.featuresChanges = this.dataService.getGeojsonChanged().features; 
    }
    ngOnInit(): void {

            if (!this.initService.isLoaded){
                console.log('ooo')
              this.initService.initLoadData$()
              .pipe( 
                take(1)
                ) 
              .subscribe( e => {
                  this.basicPassword = this.configService.user_info.password; 
                  this.commentChangeset = this.configService.getChangeSetComment();
                  this.featuresChanges = this.dataService.getGeojsonChanged().features; 
                })
            }
        
        this.basicPassword = this.configService.user_info.password;      
    }

    ngOnDestroy():void{
        console.log('destroy')
    }


    presentConfirm() {
        this.alertCtrl.create({
            header: this.translate.instant('SEND_DATA.DELETE_CONFIRM_HEADER'),
            message: this.translate.instant('SEND_DATA.DELETE_CONFIRM_MESSAGE'),
            buttons: [
                {
                    text: this.translate.instant('SHARED.CANCEL'),
                    role: 'cancel',
                    handler: () => {

                    }
                },
                {
                    text: this.translate.instant('SHARED.CONFIRM'),
                    handler: () => {
                        this.cancelAllFeatures();
                    }
                }
            ]
        }).then(alert => {
            alert.present();
        });

    }

    displayError(error) {
        this.alertCtrl.create({
            message: error,
            buttons: [
                {
                    text: this.translate.instant('SHARED.CLOSE'),
                    role: 'cancel',
                    handler: () => {

                    }
                }
            ]
        })
            .then(alert => {
                alert.present();
            });
    }

    getSummary() {
        const summary = { 'Total': 0, 'Create': 0, 'Update': 0, 'Delete': 0 };
        this.featuresChanges = this.dataService.getGeojsonChanged().features;
        const featuresChanged = this.dataService.getGeojsonChanged().features;

        for (let i = 0; i < featuresChanged.length; i++) {
            const featureChanged = featuresChanged[i];
            summary[featureChanged.properties.changeType]++;
            summary['Total']++;
        }
        return summary;
    }

    /**
     * Send this feature to OSM
     */
    private pushFeatureToOsm(featureChanged, CS, password) {
        return new Promise((resolve, reject) => {
            if (featureChanged.properties.changeType === 'Create') {
                this.osmApi.apiOsmCreateNode(featureChanged, CS, password)
                    .pipe( 
                        take(1)
                    ) 
                    .subscribe(id => {
                        let newFeature = {};
                        newFeature['type'] = 'Feature';
                        newFeature['id'] = 'node/' + id;
                        newFeature['properties'] = {};
                        newFeature['geometry'] = cloneDeep(featureChanged.geometry);
                        newFeature['properties']['type'] = 'node';
                        newFeature['properties']['id'] = id;
                        newFeature['properties']['tags'] = cloneDeep(featureChanged.properties.tags);
                        newFeature['properties']['meta'] = {};
                        newFeature['properties']['meta']['version'] = 1;
                        newFeature['properties']['meta']['user'] = this.configService.getUserInfo().display_name;
                        newFeature['properties']['meta']['uid'] = this.configService.getUserInfo().uid;
                        newFeature['properties']['meta']['timestamp'] = new Date().toISOString();
                        newFeature['properties']['time'] = new Date().getTime();

                        newFeature = this.mapService.getIconStyle(newFeature); // style
                        addAttributesToFeature(newFeature)
                        this.summary.Total--;
                        this.summary.Create--;
                        
                        this.dataService.deleteFeatureFromGeojsonChanged(featureChanged);

                        this.dataService.addFeatureToGeojson(newFeature); // creation du nouveau TODO
                        this.featuresChanges = this.dataService.getGeojsonChanged().features;
                        resolve(newFeature)
                    },
                        async error => {
                            featureChanged['error'] = error.error || error.response || 'oups';
                            this.dataService.updateFeatureToGeojsonChanged(featureChanged);
                            this.featuresChanges = this.dataService.getGeojsonChanged().features;
                            reject(error);

                        });
            } else if
                (featureChanged.properties.changeType === 'Update') {

                this.osmApi.apiOsmUpdateOsmElement(featureChanged, CS, password)
                    .pipe( 
                        take(1)
                    ) 
                    .subscribe(newVersion => {
                        let newFeature = {};
                        newFeature = featureChanged;
                        newFeature['properties']['meta']['version'] = newVersion;
                        newFeature['properties']['meta']['user'] = this.configService.getUserInfo().display_name;
                        newFeature['properties']['meta']['uid'] = this.configService.getUserInfo().uid;
                        newFeature['properties']['meta']['timestamp'] = new Date().toISOString();
                        newFeature['properties']['time'] = new Date().getTime();
                        if (newFeature['properties']['tags']['fixme']) {
                            newFeature['properties']['fixme'] = true;
                        } else {
                            if (newFeature['properties']['fixme'])
                                delete newFeature['properties']['fixme'];
                        }

                        if (newFeature['properties']['deprecated']){
                            delete newFeature['properties']['deprecated']
                        }
                        delete newFeature['properties']['changeType'];
                        delete newFeature['properties']['originalData'];


                        newFeature = this.mapService.getIconStyle(newFeature); // style
                        addAttributesToFeature(newFeature)
                        this.summary.Total--;
                        this.summary.Update--;

                        this.dataService.deleteFeatureFromGeojsonChanged(featureChanged);
                        this.dataService.addFeatureToGeojson(newFeature);

                        this.featuresChanges = this.dataService.getGeojsonChanged().features;
                        resolve(newFeature)

                    },
                        error => {
                         
                            featureChanged['error'] = error.error || error.response || 'oups';
                            this.dataService.updateFeatureToGeojsonChanged(featureChanged);
                      
                            this.featuresChanges = this.dataService.getGeojsonChanged().features;
                            
                            reject(error)
                            // this.pushFeatureToOsm(this.dataService.getGeojsonChanged().features[this.index], this.changesetId, this.index);

                        });
            } else if
                (featureChanged.properties.changeType === 'Delete') {
                if (featureChanged.properties.usedByWays){
                    let emptyFeaturetags = clone(featureChanged);
                    emptyFeaturetags['properties']['tags']= {};

                    this.osmApi.apiOsmUpdateOsmElement(emptyFeaturetags, CS, password)
                    .pipe( 
                        take(1)
                    ) 
                    .subscribe(newVersion => {
                        this.summary.Total--;
                        this.summary.Delete--;
                        this.dataService.deleteFeatureFromGeojsonChanged(featureChanged);
                        this.featuresChanges = this.dataService.getGeojsonChanged().features;
                        resolve(newVersion);
                    })
                   

                }else {
                    this.osmApi.apiOsmDeleteOsmElement(featureChanged, CS, password)
                    .pipe( 
                        take(1)
                    ) 
                    .subscribe(id => {
                        this.summary.Total--;
                        this.summary.Delete--;
                        this.dataService.deleteFeatureFromGeojsonChanged(featureChanged);
                        this.featuresChanges = this.dataService.getGeojsonChanged().features;
                        resolve(id);
                    },
                        async error => {
                            featureChanged['error'] = error.error || error.response || 'oups';
                            this.dataService.updateFeatureToGeojsonChanged(featureChanged);
                            this.featuresChanges = this.dataService.getGeojsonChanged().features;
                            reject(error)
                        });
                }
            
            }
        })
    }

    async presentAlertPassword(user_info) {
        const alert = await this.alertCtrl.create({
          header: user_info.display_name,
          inputs: [
            {
              name: 'password',
              type: 'password',
              placeholder: this.translate.instant('SEND_DATA.PASSWORD_OSM')
            }
            ],
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel',
              cssClass: 'secondary',
              handler: (blah) => {
                console.log('Confirm Cancel: blah');
              }
            }, {
              text: 'Ok',
              handler: (e) => {
                this.basicPassword = e.password;
                this.pushDataToOsm(this.commentChangeset, this.basicPassword );
              }
            }
          ]
        });
    
        await alert.present();
      }


     userIsConnected(password){
        return new Promise((resolve, reject) => {
            this.osmApi.getUserDetail$(this.configService.user_info.user, password, this.configService.user_info.authType === 'basic' ? true : false, null, true)
            .subscribe( u => {
                resolve( true)
            },
            err => {
                reject(err.error)
                if (this.configService.user_info.authType === 'basic' && !this.configService.user_info.password){
                    this.basicPassword = null;
                    this.isPushing = false;
                }
                // console.log('HTTP Error', err.error)
            }
            )
        })

     } 


    async pushDataToOsm(commentChangeset, password) {
        if (this.isPushing) {
            console.log('Already being sent')
            return;
        }
        this.configService.setChangeSetComment(commentChangeset);
        

         if (this.configService.user_info.authType == 'basic' && !this.basicPassword){
       
            await this.presentAlertPassword(this.configService.user_info)
            return

        }
        this.isPushing = true;
        let userIsConnected;
        try {
            userIsConnected = await this.userIsConnected(password);
        } catch (error) {
            this.connectionError = error;
               if (this.configService.user_info.authType === 'basic' && !this.configService.user_info.password){
                    this.basicPassword = null;
                    this.isPushing = false;
                }
            this.isPushing = false;
            return;
        }
        this.connectionError = undefined;

     
        this.osmApi.getValidChangset(commentChangeset, password)
            .pipe(
                take(1)
            )
            .subscribe(async CS => {
                const cloneGeojsonChanged = this.dataService.getGeojsonChanged()
                this.changesetId = CS;
                for (let feature of cloneGeojsonChanged.features) {
                    try {
                        await this.pushFeatureToOsm(feature, this.changesetId, password)
                    } catch (error) {
                        console.log(error)
                    }
                };
                this.isPushing = false;
                this.summary = this.getSummary();
                this.mapService.eventMarkerReDraw.emit(this.dataService.getGeojson());
                this.mapService.eventMarkerChangedReDraw.emit(this.dataService.getGeojsonChanged());
                this.featuresChanges = this.dataService.getGeojsonChanged().features;
                if (this.dataService.getGeojsonChanged().features.length === 0) { // Y'a plus d'éléments à pusher
                    this.navCtrl.pop();
                }
            });
    }

    async cancelAllFeatures() { // rollBack
        const featuresChanged = this.dataService.getGeojsonChanged().features;
        for (let feature of featuresChanged) {
            this.dataService.cancelFeatureChange(feature);
        }
        await this.dataService.resetGeojsonChanged();
        this.summary = this.getSummary();
        this.featuresChanges = this.dataService.getGeojsonChanged().features;
        timer(100).pipe(take(1)).subscribe(t => {
            this.mapService.eventMarkerReDraw.emit(this.dataService.getGeojson());
            this.mapService.eventMarkerChangedReDraw.emit(this.dataService.getGeojsonChanged());
            this.navCtrl.pop();
        });
    }

    centerToElement(pointCoordinates) {
        if (this.mapService.map.getZoom() < 18.5) {
            this.mapService.map.setZoom(18.5);
        }
        this.mapService.map.setCenter(pointCoordinates);
        this.navCtrl.pop();
    }

    ngAfterViewInit() {
        this.summary = this.getSummary();
    }

}


