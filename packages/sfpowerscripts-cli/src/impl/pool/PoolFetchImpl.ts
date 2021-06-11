import SFPLogger from "@dxatscale/sfpowerscripts.core/lib/logger/SFPLogger";
import { fs, LoggerLevel, Org, SfdxError } from "@salesforce/core";
import child_process = require("child_process");
import ShareScratchOrg from "./operations/ShareScratchOrg";
import { PoolBaseImpl } from "./PoolBaseImpl";
import ScratchOrg from "./ScratchOrg";
import { getUserEmail } from "./services/fetchers/GetUserEmail";
import ScratchOrgInfoFetcher from "./services/fetchers/ScratchOrgInfoFetcher";
import ScratchOrgInfoAssigner from "./services/updaters/ScratchOrgInfoAssigner";



export default class PoolFetchImpl extends PoolBaseImpl{

  private tag: string;
  private mypool: boolean;
  private sendToUser: string;
  private alias: string;
  private setdefaultusername:boolean;

  public constructor(
    hubOrg: Org,
    tag: string,
    mypool: boolean,
    sendToUser?: string,
    alias?: string,
    setdefaultusername?:boolean
  ) {
    super(hubOrg);
    this.tag = tag;
    this.mypool = mypool;
    this.sendToUser = sendToUser;
    this.alias = alias;
    this.setdefaultusername = setdefaultusername;
  }

  protected async onExec(): Promise<ScratchOrg> {
   
    const results = (await new ScratchOrgInfoFetcher(this.hubOrg).getScratchOrgsByTag(
      this.tag,
      this.mypool,
      true
    )) as any;

    let availableSo = [];
    if (results.records.length > 0) {
      availableSo = results.records.filter(
            (soInfo) => soInfo.Allocation_status__c === "Available"
          );
    }
    let emaiId;
    if (this.sendToUser) {
      try {
        emaiId = await getUserEmail(this.sendToUser, this.hubOrg);
      } catch (error) {
        SFPLogger.log(
          "Unable to fetch details of the specified user, Check whether the user exists in the org ",
          LoggerLevel.ERROR
        );
        throw new SfdxError("Failed to fetch user details");
      }
    }

    let soDetail: ScratchOrg;

    if (availableSo.length > 0) {
      SFPLogger.log(
        `${this.tag} pool has ${availableSo.length} Scratch orgs available`,
        LoggerLevel.TRACE
      );

      for (let element of availableSo) {
        let allocateSO = await new ScratchOrgInfoAssigner(this.hubOrg).setScratchOrgInfo(
          { Id: element.Id, Allocation_status__c: "Allocate" }
        );
        if (allocateSO === true) {
          SFPLogger.log(
            `Scratch org ${element.SignupUsername} is allocated from the pool. Expiry date is ${element.ExpirationDate}`,
            LoggerLevel.TRACE
          );
          soDetail = {};
          soDetail["Id"] = element.Id;
          soDetail.orgId = element.ScratchOrg;
          soDetail.loginURL = element.LoginUrl;
          soDetail.username = element.SignupUsername;
          soDetail.password = element.Password__c;
          soDetail.expityDate = element.ExpirationDate;
          soDetail.sfdxAuthUrl = element.SfdxAuthUrl__c;
          soDetail.status = "Assigned";

          break;
        } else {
          SFPLogger.log(
            `Scratch org ${element.SignupUsername} allocation failed. trying to get another Scratch org from ${this.tag} pool`,
            LoggerLevel.TRACE
          );
        }
      }
    }

    if (availableSo.length == 0 || !soDetail) {
      throw new SfdxError(
        `No scratch org available at the moment for ${this.tag}, try again in sometime.`
      );
    }

    if (this.sendToUser) {
      //Fetch the email for user id
      try {
        //Send an email for username
        await new ShareScratchOrg(this.hubOrg,soDetail).shareScratchOrgThroughEmail(
          emaiId
        );
      } catch (error) {
        SFPLogger.log(
          "Unable to send the scratchorg details to specified user. Check whether the user exists in the org",
          LoggerLevel.ERROR
        );
      }
    }

    return soDetail;
  }

  public loginToScratchOrgIfSfdxAuthURLExists(soDetail: ScratchOrg) {
    if (soDetail.sfdxAuthUrl) {

      if (!this.isValidSfdxAuthUrl(soDetail.sfdxAuthUrl)) {
        return;
      }

      let soLogin: any = {};
      soLogin.sfdxAuthUrl = soDetail.sfdxAuthUrl;
      fs.writeFileSync("soAuth.json", JSON.stringify(soLogin));

      SFPLogger.log(
        `Initiating Auto Login for Scratch Org with ${soDetail.username}`,
        LoggerLevel.INFO
      );

      let authURLStoreCommand:string = `sfdx auth:sfdxurl:store -f soAuth.json`;

      if(this.alias)
         authURLStoreCommand+=` -a ${this.alias}`;
      if(this.setdefaultusername)
          authURLStoreCommand+=` --setdefaultusername`;

         child_process.execSync(
          authURLStoreCommand,
          { encoding: "utf8", stdio: "inherit" }
        );;

      fs.unlinkSync("soAuth.json");


      //Run shape list to reassign this org to the pool
      child_process.execSync(`sfdx force:org:shape:list`, {
        encoding: "utf8",
        stdio: "pipe",
      });

    }
  }


  private isValidSfdxAuthUrl(sfdxAuthUrl: string): boolean {
    if (sfdxAuthUrl.match(/force:\/\/(?<refreshToken>[a-zA-Z0-9._]+)@.+/)) {
      return true;
    } else {
      let match = sfdxAuthUrl.match(/force:\/\/(?<clientId>[a-zA-Z]+):(?<clientSecret>[a-zA-Z0-9]*):(?<refreshToken>[a-zA-Z0-9._]+)@.+/)

      if (match !== null) {
        if (match.groups.refreshToken === "undefined") {
          return false;
        } else {
          return true;
        }
      } else {
        return false;
      }
    }
  }

  
}
