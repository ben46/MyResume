const {
    marketAllContracts,
    getParms,
    increasePosition,
    decreasePosition,
    formatPositions: getFormatPositions,
    getVaildResultData,
    getPnl
} = require("./prams")
const { handleTx } = require("../utils")
const { deployOrConnect } = require("../../scripts/helpers")
const { BigNumber: BN } = require("ethers");
const { expect, use } = require("chai");
const { ethers } = require("hardhat");
const { float } = require("hardhat/internal/core/params/argumentTypes");

function addDecimals(num, decimals) {
    num = String(num)
    const zeros = ethers.utils.parseUnits("1", decimals) //_price
    if (num.indexOf(".") < 0) {
        return BN.from(num).mul(zeros)
    }
    const [left, right, ...rest] = num.split(".")
    const num1 = BN.from(left).mul(zeros)
    const right_de = decimals - right?.length
    const zeros2 = ethers.utils.parseUnits("1", right_de)
    const num2 = BN.from(right).mul(zeros2)
    return num1.add(num2)
}
function isFloat(n) {
    return Number(n) === n && n % 1 !== 0;
}
function formatFloat(num, decimals = 6) {
    if (false == isFloat(num)) {
        return num
    }
    return parseFloat(num.toFixed(decimals));
}
const COLLATERAL_TOKEN_DECIMAL = 18
const ERROR_ALLOW = BN.from("10000")

class MarketCls {
    constructor({ isLong = true } = {}) {
        this.isLong = isLong
    }

    async initialize() {
        this.contracts = await marketAllContracts()
        const { user, reader, market, oracle, eth, feeVault, usdc, maketArgs, feeRouter } = this.contracts
        this.feeRouter = feeRouter
        this.vault = {
            address: this.contracts.marketArgs.mktOuts.vault
        }

        await handleTx(feeRouter.setPositionBook(await market.positionBook()))

        this.user = user
        this.reader = reader
        this.market = market
        this.oracle = oracle
        this.eth = eth
        this.feeVault = feeVault
        this.usdc = usdc
        this.maketArgs = maketArgs
        const [wallet, user0, user1] = await ethers.getSigners();
        this.wallet = wallet
        this.indexToken = await this.market.indexToken()
        // this.size = 0
        await handleTx(
            feeRouter.setLiquidateFeeRate([market.address], ["5000000000000000000"]),
            "feeRouter.setLiquidateFeeRate"
        );

        const signers = await ethers.getSigners()
        let addrs = []
        for (let index = 0; index < signers.length; index++) {
            const element = signers[index];
            addrs.push(element.address)
        }
        this.users = await ethers.getSigners()
        console.log("==================================================");
        console.log("==================================================");
    }

    getUser(index) {
        return this.users[index];
    }

    async getOrderStore({ isLong, isIncrease }) {
        let addr = ""
        if (isLong && isIncrease) {
            addr = this.contracts._openStoreLong
        }
        if (isLong && !isIncrease) {
            addr = this.contracts._closeStoreLong
        }
        if (!isLong && isIncrease) {
            addr = this.contracts._openStoreShort
        }
        if (!isLong && !isIncrease) {
            addr = this.contracts._closeStoreShort
        }
        const contractFactory = await ethers.getContractFactory("OrderStore")
        return await contractFactory.attach(addr)
    }

    async getCurrentBlockTimeStamp() {
        const provider = waffle.provider // ethers.provider
        const blockNumber = await provider.getBlockNumber();
        const block = await provider.getBlock(blockNumber);
        console.log(`Block ${blockNumber} timestamp: ${block.timestamp}`);
        return block.timestamp
    }

    async advanceOneDay() {
        const previousTS = await this.getCurrentBlockTimeStamp()
        const provider = waffle.provider // ethers.provider
        await provider.send("evm_setNextBlockTimestamp", [previousTS + 86400]);
        await provider.send("evm_mine");
        await this.getCurrentBlockTimeStamp()
    }

    async updateFundFee() {
        await this.increaseMarket({
            user: this.getUser(2),
            price: this.price, pay: 20, size: 200
        })
    }

    async advanceOneHour() {
        const provider = waffle.provider // ethers.provider
        await provider.send("evm_setNextBlockTimestamp", [Math.floor(Date.now() / 1000) + 3600]);
        await provider.send("evm_mine");
    }

    async getFundFee({ user = this.wallet } = {}) {
        const ff = await this.feeRouter.getFundingFee(
            user.address, this.market.address, this.isLong
        )
        console.log(ff);
        const ppp = ethers.utils.formatUnits(ff, COLLATERAL_TOKEN_DECIMAL)
        console.log(ppp);
        return ppp
    }

    async validFundFee({ amount, user = this.wallet } = {}) {
        const ff = await this.getFundFee({ user: user })
        expect(ff, "资金费不对").eq(amount)
    }

    async getOrders({ isOpen, price } = {}) {
        const orderBookLong = this.contracts.orderBookLong
        return await orderBookLong.getExecutableOrdersByPrice(
            0,
            50,
            isOpen,
            addDecimals(String(price), 30)
        )
    }

    async initAutoOrder({ limit = 5, isOpen = true } = {}) {
        const autoOrderType = isOpen ? "AutoOpenOrderMock" : "AutoCloseOrderMock";
        const autoOrder = await deployOrConnect(
            "AutoOpenOrderMock",
            [this.oracle.address, limit, isOpen],
            autoOrderType
        );
        await handleTx(
            autoOrder.addMarket(this.market.address)
        )
        if (isOpen) {
            this.autoOpenOrder = autoOrder;
        } else {
            this.autoCloseOrder = autoOrder;
        }
        return autoOrder;
    }

    async initAutoOpen({ limit = 5 } = {}) {
        return this.initAutoOrder({ limit: limit, isOpen: true });
    }

    async initAutoClose({ limit = 5 } = {}) {
        return this.initAutoOrder({ limit: limit, isOpen: false });
    }

    async runAutoOpen() {
        const balance0 = await this.userBalance()
        this.lastTx = await this.autoOpenOrder.performUpkeep(
            this.getMarket().address, 0, 50
        )
        this.lastReceipt = await this.lastTx.wait()
        const balance1 = await this.userBalance()
        this.balanceChange = balance1.sub(balance0)
    }

    async runAutoClose() {
        const balance0 = await this.userBalance()
        this.lastTx = await this.autoCloseOrder.performUpkeep(
            this.getMarket().address, 0, 50
        )
        this.lastReceipt = await this.lastTx.wait();
        const balance1 = await this.userBalance()
        this.balanceChange = balance1.sub(balance0)
    }

    async checkOrdersToExecute({ num, isOpen } = {}) {
        if (isOpen) {
            const res = await this.autoOpenOrder.checkExecOrder(
                this.getMarket().address,
                0, 50
            )
            expect(res[0], "开仓订单数量校验失败").eq(num)
        } else {
            const res = await this.autoCloseOrder.checkExecOrder(
                this.getMarket().address,
                0, 50
            )
            expect(res[0], "平仓订单数量校验失败").eq(num)
        }
    }

    getOrderKey({ account, orderID } = {}) {
        const hash = ethers.utils.solidityKeccak256(
            ["address", "uint256"],
            [account, orderID]
        );
        return hash
    }

    async validOrderDeleted({ isOpen, user = this.wallet, orderID }) {
        expect(orderID, "订单ID不能0").not.eq(0)
        const orderKey = this.getOrderKey({ orderID: orderID, account: user.address })
        const os = await this.getOrderStore({
            isIncrease: isOpen,
            isLong: this.isLong
        })
        let exsits = await os.containsKey(orderKey);
        expect(exsits, "订单应该被删除").eq(false)
    }

    async checkExecOrder() {
        return this.autoOpenOrder.checkExecOrder(this.market.address, 0, 50)
    }

    getOracle() {
        return this.oracle
    }

    getMarket() {
        return this.market
    }

    async setPrice(price) {
        this.price = price
        // 修改预言机价格
        await handleTx(
            this.oracle.setPrice(
                this.indexToken,
                ethers.utils.parseUnits(price + "", 30)
            ), "oracle.setPrice"
        )
    }

    async increaseLongMarket({ price = 1700, pay = 20, size = 200, user = this.wallet } = {}) {
        await this.increaseMarket({ price: price, pay: pay, size: size, isLong: true, user: user })
    }

    async increaseShortMarket({ price = 1700, pay = 20, size = 200, user = this.wallet } = {}) {
        await this.increaseMarket({ price: price, pay: pay, size: size, isLong: false, user: user })
    }

    async increaseMarket({ price, tp = 0, sl = 0, pay, size, isLong = this.isLong, user = this.wallet } = {}) {
        const balance0 = await this.usdc.balanceOf(user.address)
        const size0 = await this.getSize({ user: user })
        const price = addDecimals(String(price), 30)
        await handleTx(this.usdc.connect(user).approve(
            this.market.address,
            ethers.utils.parseUnits(pay + "", COLLATERAL_TOKEN_DECIMAL)
        ), "approve")

        await handleTx(
            this.market.connect(user).increaseTrade(
                false, //_isLimit
                ethers.utils.parseUnits(String(pay), COLLATERAL_TOKEN_DECIMAL), //_payDelta
                ethers.utils.parseUnits(String(size), COLLATERAL_TOKEN_DECIMAL), //_payDelta
                price, //_price
                ethers.utils.parseUnits(String(tp), 30), //_price
                ethers.utils.parseUnits(String(sl), 30), //_price
                "30", //_slippage
                isLong, //_isLong
                false //_isExec
            ),
            isLong ? "开多" : "开空"
        );
        if (isLong != this.isLong) {
            return
        }
        const size1 = await this.getSize({ user: user })
        expect(
            ethers.utils.parseUnits(String(size), COLLATERAL_TOKEN_DECIMAL),
            "开仓后增加的size不对"
        ).eq(size1.sub(size0))
        const balance1 = await this.usdc.balanceOf(user.address)
        expect(balance0.sub(balance1), "开仓用户扣pay校验失败").eq(
            ethers.utils.parseUnits(pay + "", await this.usdc.decimals())
        )
        this.balanceChange = balance1.sub(balance0)
    }

    async validBalanceChange(change) {
        const right = parseFloat(this.balanceChange)
        const decimals = await this.usdc.decimals()
        expect(
            change * (10 ** decimals),
            "用户金额变动不对"
        ).within(
            right - 1,
            right + 1
        )
    }

    async increaseLimit({ price, pay = 20, size = 200, isLong = this.isLong, user = this.wallet } = {}) {
        // getParms(500, 1000, indexPrice, 300) 
        // this.size += size
        const balance0 = await this.usdc.balanceOf(user.address)
        const v = addDecimals(String(price), 30)
        await handleTx(this.usdc.connect(user).approve(
            this.market.address,
            ethers.utils.parseUnits(pay + "", COLLATERAL_TOKEN_DECIMAL)
        ), "approve")

        await handleTx(
            this.market.connect(user).increaseTrade(
                true, //_isLimit
                ethers.utils.parseUnits(pay + "", COLLATERAL_TOKEN_DECIMAL), //_payDelta
                ethers.utils.parseUnits(size + "", COLLATERAL_TOKEN_DECIMAL), //_payDelta
                v, //_price
                ethers.utils.parseUnits("0", 30), //_price
                ethers.utils.parseUnits("0", 30), //_price
                BN.from("30"), //_slippage
                isLong, //_isLong
                false //_isExec
            ),
            isLong ? "limit开多" : "limit开空"
        );
        //valid order created
        const balance1 = await this.usdc.balanceOf(user.address)
        expect(balance0.sub(balance1), "开仓用户扣pay校验失败").eq(
            ethers.utils.parseUnits(pay + "", await this.usdc.decimals())
        )
    }

    async validUSDC(diff, exp) {
        expect(
            ethers.utils.parseUnits(
                exp + "",
                await this.usdc.decimals()
            )
        ).eq(diff)
    }

    async validSize(size) {
        let position = await this.getPosition()

        expect(
            ethers.utils.parseUnits(size + "", COLLATERAL_TOKEN_DECIMAL), "size校验"
        ).within(
            position['size'].sub(ERROR_ALLOW),
            position['size'].add(ERROR_ALLOW)
        )
    }

    async getSize({ user = this.wallet } = {}) {
        let position = await this.getPosition({ user: user })
        return position['size']
    }

    async decreaseLongMarket({ price, size, isKeepLev = true, user = this.wallet } = {}) {
        await this.decreaseMarket({
            price: price, size: size, isLong: true, isKeepLev: isKeepLev, user: user
        })
    }

    async decreaseShortMarket({ price, size, isKeepLev = true, user = this.wallet } = {}) {
        await this.decreaseMarket({
            price: price, size: size, isLong: false, isKeepLev: isKeepLev, user: user
        })
    }

    async decreaseMarket({ price, size, isLong = true, isKeepLev = true, user = this.wallet } = {}) {
        await this.advanceBlock();
        const balance0 = await this.userBalance({ user: user })
        const size0 = await this.getSize({ user: user })
        // this.size -= size
        const tx = await this.market.connect(user).decreaseTrade(
            false, //_isLimit
            ethers.utils.parseUnits(String(size), COLLATERAL_TOKEN_DECIMAL), //_payDelta
            isKeepLev, //_isKeepLev
            ethers.utils.parseUnits(String(price), 30), //_price
            BN.from("300"), //_slippage
            isLong, //_isLong
            false
        )
        await tx.wait()
        //await handleTx(tx, isLong ? "平多" : "平空");
        const balance1 = await this.userBalance()
        this.balanceChange = balance1.sub(balance0)
        this.lastTx = tx
        const size1 = await this.getSize({ user: user })
        expect(
            ethers.utils.parseUnits(String(size), COLLATERAL_TOKEN_DECIMAL),
            "减仓的size不对"
        ).eq(size0.sub(size1))

    }

    async advanceBlock() {
        const provider = waffle.provider // ethers.provider

        const blockNumber0 = await provider.getBlockNumber()

        await provider.send("evm_mine", []);

        const blockNumber1 = await provider.getBlockNumber()
        console.log(blockNumber0, blockNumber1)

    }

    async validEvent({ name = "DeleteOrder", num, tx = this.lastTx }) {
        const events = await this.market.queryFilter(name, tx.blockNumber);
        for (const event of events) {
            console.log(event.args); // log the event arguments
            // console.log(event); // log the full event object
        }
        expect(events.length, "DeleteOrder事件触发次数不对").to.equal(num);
    }

    async validUpdatePosition({ price } = {}) {
    }

    async validUpdatePositionFromOrder({ price } = {}) {
        const name = "UpdatePositionFromOrder"
        const events = await this.market.queryFilter(name, this.lastTx.blockNumber);
        console.log(events);
        expect(events.length).gt(0)
        expect(
            events[0].args.price,
            "UpdatePositionFromOrder 中的价格不对"
        ).eq(ethers.utils.parseUnits(
            String(price), 30
        ))
    }

    async validTransfer({ from, to, amount, label = "" }) {
        const name = "Transfer"
        const events = await this.usdc.queryFilter(name, this.lastTx.blockNumber);
        amount = formatFloat(amount, await this.usdc.decimals())
        const tmp = ethers.utils.parseUnits(String(amount), await this.usdc.decimals())
        let found = 0
        let found0 = false
        for (const event of events) {
            if (event.args.to == to &&
                event.args.from == from) {
                found0 = true
                console.log(event.args.value, amount);
                if (String(tmp) == String(event.args.value)) {
                    return
                }
                found = event.args.value
            }
        }
        if (found0) {
            expect(tmp, label).eq(found);
        } else {
            expect(true, "没有找到转账记录").eq(false)
        }
    }

    async validUserReceive(amount) {
        await this.validTransfer({
            from: this.market.address,
            to: this.wallet.address,
            amount: amount,
            label: "用户receive不对"
        })
    }

    async validVaultReceive(amount) {
        await this.validTransfer({
            from: this.market.address,
            to: this.vault.address,
            amount: amount,
            label: "vault转入金额不正确"
        })
    }

    async validFeeVaultReceive(amount) {
        await this.validTransfer({
            from: this.market.address,
            to: this.feeVault.address,
            amount: amount,
            label: "fee vault转入金额不正确"
        })
    }

    async increaseCollateral({ pay } = {}) {
        this.lastTx = await this.market.increaseCollateral(
            ethers.utils.parseUnits(String(pay), COLLATERAL_TOKEN_DECIMAL),
            this.isLong
        )
        this.lastReceipt = await this.lastTx.wait()
    }

    async validVaultTransferOut(amount) {
        await this.validTransfer({
            from: this.vault.address,
            to: this.market.address,
            amount: amount,
            label: "vault转出金额不正确"
        })
    }

    async validFeeVaultTransferOut(amount) {
        await this.validTransfer({
            from: this.feeVault.address,
            to: this.market.address,
            amount: amount,
            label: "fee vault转出金额不正确"
        })
    }

    async validDeleteOrderEvent({ num, orderID }) {
        const name = "DeleteOrder"
        const events = await this.market.queryFilter(name, this.lastTx.blockNumber);
        for (const event of events) {
            expect(event.args.orderID, "DeleteOrder事件触发ID不对").eq(String(orderID))
            // console.log(event.args); // log the event arguments
            // console.log(event); // log the full event object
        }
        expect(events.length, "DeleteOrder事件触发次数不对").to.equal(num);
    }

    async decreaseLimit({ label = "", user = this.wallet, price, size = 200, isLong = true, isKeepLev = true, isRevert = false } = {}) {
        if (isRevert) {
            await expect(this.market.connect(user).decreaseTrade(
                true, //_isLimit
                ethers.utils.parseUnits(String(size), COLLATERAL_TOKEN_DECIMAL), //_payDelta
                isKeepLev, //_isKeepLev
                ethers.utils.parseUnits(String(price), 30), //_price
                BN.from("300"), //_slippage
                isLong, //_isLong
                false
            ), "下平仓单没有revert").to.be.reverted
            return
        }
        await handleTx(
            this.market.connect(user).decreaseTrade(
                true, //_isLimit
                ethers.utils.parseUnits(String(size), COLLATERAL_TOKEN_DECIMAL), //_payDelta
                isKeepLev, //_isKeepLev
                ethers.utils.parseUnits(String(price), 30), //_price
                BN.from("300"), //_slippage
                isLong, //_isLong
                false
            ),
            label
        );
    }

    async cancelOrder({ isIncrease, orderID, isLong = this.isLong } = {}) {
        const balance0 = await this.userBalance()
        //TODO
        //删除订单
        this.lastTx = await this.market.cancelOrder(
            isIncrease, orderID, isLong
        )
        const balance1 = await this.userBalance()
        this.balanceChange = balance1.sub(balance0)
    }

    async getPosition({ user = this.wallet } = {}) {
        let positions = await this.reader.getPositions(
            user.address,
            this.market.address
        );
        return positions[this.isLong ? 0 : 1]
    }

    async validPnl({ pnl }) {
        let position = await this.getPosition()
        const v = addDecimals(pnl, COLLATERAL_TOKEN_DECIMAL)
        expect(
            v,
            "pnl验证失败"
        ).within(
            position['realisedPnl'].sub(ERROR_ALLOW),
            position['realisedPnl'].add(ERROR_ALLOW)
        )
    }

    async getPositionRows({ user = this.wallet, isLong } = {}) {
        const UserPosition = await this.reader.getPositions(
            user.address,
            this.market.address
        )
        const formatRows = getFormatPositions(UserPosition)
        let long = formatRows.find((row) => row.isLong);
        let short = formatRows.find((row) => !row.isLong)
        return isLong ? long : short
    }

    async checkCollateral(coll) {
        let position = await this.getPosition()
        expect(
            ethers.utils.parseUnits(coll + "", COLLATERAL_TOKEN_DECIMAL),
            "保证金失败"
        ).eq(position['collateral'])
    }

    async validCollateral(coll) {
        await this.checkCollateral(coll)
    }

    async userBalance({ user = this.wallet } = {}) {
        return await this.usdc.balanceOf(user.address)
    }

}
module.exports = {
    MarketCls
};
