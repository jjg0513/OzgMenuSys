
var cfg = require("./cfg");
var cmd = require("./cmd");
var strings = require("./strings");
var commons = require("./commons");
var fs = require('fs');
var sqlite3 = require("sqlite3").verbose();

var db = new sqlite3.Database(cfg.DB_PATH);   

var chkClientSql = "select * from client where ip = '{0}' and status = 1";
var chkClientSql2 = "select * from client where ip = '{0}'"; //检测订单是否归档的时候用到

var clientList = null;

function writeErrorIp(connection) {
	console.log("查询不到ip为" + connection.remoteAddress + "的数据");
			
	var outputStr = commons.outputJsonStr(0, strings.CHECK_MSG1);
			
	connection.sendUTF(outputStr);
	connection.close();
}

function writeDbData(connection, sql) {
	db.get(commons.format(chkClientSql, connection.remoteAddress), function(err, row) {
		if(row != undefined && row) {
			
			db.all(sql, function(err, rows) {

				var outputStr = commons.outputJsonStr(1, "", "", rows);			
				connection.sendUTF(outputStr);
			});
		}
		else {
			//查询不到数据
			
			writeErrorIp(connection);
		}

	});
}

//有链接时调用
function checkClient(connection) {
	
	db.get("select * from client where ip = '" + connection.remoteAddress + "'", function(err, row) {
		if(row != undefined && row) {
			
			//console.log("已接收ip " + row.ip + "发来的数据:" + data);
			
			if(row.status == 0) {
				//未开通
				var outputStr = commons.outputJsonStr(0, commons.format(strings.CHECK_MSG2, row.name));
				connection.sendUTF(outputStr);
			}
			else if(row.status == 1) {
				//已开通的逻辑
				
				var data = {
					"client": row
				};
				var outputStr = commons.outputJsonStr(1, commons.format(strings.CHECK_MSG3, row.name), cmd.CLIENT_WANT_TOMAIN, data);
				connection.sendUTF(outputStr);
			}

		}
		else {
			//查询不到数据
			
			writeErrorIp(connection);
		}

	});	
}

//获取菜单分类列表
function getMenuClassList(connection) {
	var sql = "select * from menu_class order by id desc, sort desc";
	writeDbData(connection, sql);
}

//获取一个菜单分类下面的菜单列表
function getMenuList(connection, dataId) {
	var sql = "select m.*, mc.name as mc_name from menu as m inner join menu_class as mc on m.class_id = mc.id where m.class_id = " + dataId + " order by m.id desc, m.sort desc";
	writeDbData(connection, sql);	
}

//获取一个菜单的详细数据
/*function getMenuDetail(connection, dataId) {	
	db.get(commons.format(chkClientSql, connection.remoteAddress), function(err, row) {
		if(row != undefined && row) {
			
			db.get("select m.*, mc.name as mc_name from menu as m inner join menu_class as mc on m.class_id = mc.id where m.id = " + dataId, function(err, row) {

				var outputStr = commons.outputJsonStr(1, "", "", row);			
				connection.sendUTF(outputStr);
			});
		}
		else {
			//查询不到数据
			
			writeErrorIp(connection);
		}

	});

}*/

//获取一个图片
function getMenuImage(connection, dataId, isSmall) {
	
	db.get(commons.format(chkClientSql, connection.remoteAddress), function(err, row) {
		if(row != undefined && row) {
			
			db.get("select m.*, mc.name as mc_name from menu as m inner join menu_class as mc on m.class_id = mc.id where m.id = " + dataId, function(err, row2) {
				var imgStr = null;
				if(isSmall)
					imgStr = commons.fileBase64Encode("./" + row2.small_img);
				else 
					imgStr = commons.fileBase64Encode("./" + row2.big_img);

				var data = {};
				data.img_base64str = imgStr;
				data.menu_data = row2;

				var outputStr = commons.outputJsonStr(1, "", "", data);
				connection.sendUTF(outputStr);
			});
			
		}
		else {
			//查询不到数据
			
			writeErrorIp(connection);
		}

	});

}

//获取一个小图
function getMenuSmallImage(connection, dataId) {
	
	getMenuImage(connection, dataId, true);

}

//获取一个大图
function getMenuBigImage(connection, dataId) {
	
	getMenuImage(connection, dataId, false);

}

//点菜
function addOrderDetail(connection, menuId, quantity) {
	
	if(quantity == undefined || quantity == 0)
		quantity = 1;
	
	db.get(commons.format(chkClientSql, connection.remoteAddress), function(err, row) {
		if(row != undefined && row) {
			
			db.get("select * from menu where id = " + menuId, function(err, row2) {
				
				db.get("select id from `order` where client_id = " + row.id + " and status = 0 order by id desc, add_time desc limit 1", function(err, row3) {
					
					var addTime = Date.parse(new Date()) / 1000;
					db.run("insert into order_detail (add_time, menu_id, price, quantity, menu_name, order_id) values(" + addTime + ", " + row2.id + ", " + row2.price + ", " + quantity + ", '" + row2.name + "', " + row3.id + ")");
					
					var updateTime = addTime;
					db.run("update `order` set update_time = " + updateTime + " where id = " + row3.id);

					var outputStr = commons.outputJsonStr(1, commons.format(strings.MENU_ADD_MSG, row2.name));
					connection.sendUTF(outputStr);
				});
			});
		}
		else {
			//查询不到数据
			
			writeErrorIp(connection);
		}

	});

}

//获取当前客户端的订单列表
function getOrderList(connection) {
	
	var sql = "select od.*, o.update_time as o_update_time from order_detail as od left join `order` as o on od.order_id = o.id left join client as c on o.client_id = c.id where c.ip = '" + connection.remoteAddress + "' and o.status = 0";
	writeDbData(connection, sql);
}

//当前客户端结帐
function orderPayment(connection) {

	//订单状态：0正在消费，1结帐中，2完成订单
	
	db.get(commons.format(chkClientSql, connection.remoteAddress), function(err, row) {
		if(row != undefined && row) {
									
			var sql = "select sum(od.price * od.quantity) as total_price from order_detail as od left join `order` as o on od.order_id = o.id left join client as c on o.client_id = c.id where c.ip = '" + connection.remoteAddress + "' and o.status = 0";
			db.get(sql, function(err, row2) {
				
				if(row2.total_price != null && row2.total_price > 0) {
					//改为结账中，完成订单是服务台操作的
					var updateTime = (new Date()).getTime() / 1000;

					var sql = "update `order` set status = 1, update_time = " + parseInt(updateTime) + " where status = 0 and client_id = " + row.id;
					db.run(sql);

					var outputStr = commons.outputJsonStr(1, commons.format(strings.MENU_PAYMENT_MSG1, row2.total_price));
					connection.sendUTF(outputStr);
				}
				else {
					var outputStr = commons.outputJsonStr(0, strings.MENU_PAYMENT_MSG2);
					connection.sendUTF(outputStr);
				}
				
			});
			
		}
		else {
			//查询不到数据
			
			writeErrorIp(connection);
		}

	});

}

function isEndClient(connection) {
	//检测订单是否已归档
	db.get(commons.format(chkClientSql2, connection.remoteAddress), function(err, row) {
		if(row != undefined && row) {
			
			db.get("select count(id) as total from `order` where status < 2 and client_id = " + row.id, function(err, row2) {
				if(row2.total > 0) {
					//未归档
					var outputStr = commons.outputJsonStr(0);
					connection.sendUTF(outputStr);
				}
				else {
					//已归档
					var outputStr = commons.outputJsonStr(1);
					connection.sendUTF(outputStr);
				}
			});
						
		}
		else {
			//查询不到数据
			
			writeErrorIp(connection);
		}

	});
}

function openClient(connection, targetClientIp) {
	//服务台开通一个客户端
	db.get(commons.format(chkClientSql, connection.remoteAddress), function(err, row) {
		if(row != undefined && row) {
									
			if(row.is_admin == 1) {
												
				db.get("select * from client where ip = '" + targetClientIp + "'", function(err, row2) {
					
					var sql = "update client set status = 1 where ip = '" + targetClientIp + "'";
					db.run(sql);

					var addTime = (new Date()).getTime() / 1000;
					var updateTime = addTime;
					sql = "insert into `order` (add_time, update_time, client_id) values(" + parseInt(addTime) + ", " + parseInt(updateTime) + ", " + row2.id + ")";
					db.run(sql);
					
					//对目标客户端发送跳转命令
					var data = {
						"client": row2
					};
					var outputStr = commons.outputJsonStr(1, commons.format(strings.NOTICE_MSG1, row2.name), cmd.CLIENT_WANT_TOMAIN, data);
					for(var i = 0; i < clientList.length; i++) {
						if(targetClientIp == clientList[i].remoteAddress) {
							//console.log(outputStr);
							clientList[i].sendUTF(outputStr);
							break;
						}
					}

					//返回服务台的信息
					outputStr = commons.outputJsonStr(1, commons.format(strings.NOTICE_MSG1, row2.name));
					connection.sendUTF(outputStr);
				});
				
			}
			else {
				var outputStr = commons.outputJsonStr(0, commons.format(strings.CHECK_MSG4, connection.remoteAddress));
				connection.sendUTF(outputStr);
			}
			
		}
		else {
			//查询不到数据
			
			writeErrorIp(connection);
		}

	});
}

function closeClient(connection, targetClientIp) {
	//服务台归档一个客户端
	db.get(commons.format(chkClientSql, connection.remoteAddress), function(err, row) {
		if(row != undefined && row) {
									
			if(row.is_admin == 1) {
				
				db.get("select * from client where ip = '" + targetClientIp + "'", function(err, row2) {
					var sql = "update client set status = 0 where ip = '" + targetClientIp + "'";
					db.run(sql);

					var updateTime = (new Date()).getTime() / 1000;
					sql = "update `order` set status = 2, update_time = " + parseInt(updateTime) + " where status = 1 and client_id = " + row2.id;
					db.run(sql);

					/*var outputStr = commons.outputJsonStr(1, commons.format(strings.NOTICE_MSG2, row2.name));
					for(var i = 0; i < clientList.length; i++) {
						if(targetClientIp == clientList[i].remoteAddress) {
							clientList[i].sendUTF(outputStr);
							break;
						}
					}*/

					//返回服务台的信息
					var outputStr = commons.outputJsonStr(1, commons.format(strings.NOTICE_MSG2, row2.name));
					connection.sendUTF(outputStr);
				});
				
			}
			else {
				var outputStr = commons.outputJsonStr(0, commons.format(strings.CHECK_MSG4, connection.remoteAddress));
				connection.sendUTF(outputStr);
			}
			
		}
		else {
			//查询不到数据
			
			writeErrorIp(connection);
		}

	});
}

exports.setClientList = function(pClientList) {
	clientList = pClientList;
};

exports.checkClient = checkClient;
exports.getMenuClassList = getMenuClassList;
exports.getMenuList = getMenuList;
//exports.getMenuDetail = getMenuDetail;
exports.getMenuSmallImage = getMenuSmallImage;
exports.getMenuBigImage = getMenuBigImage;
exports.addOrderDetail = addOrderDetail;
exports.getOrderList = getOrderList;
exports.orderPayment = orderPayment;
exports.isEndClient = isEndClient;
exports.openClient = openClient;
exports.closeClient = closeClient;